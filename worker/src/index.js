function sanitizeImageUrl(url) {
  if (!url) return undefined;
  let value = String(url).trim();
  if (value.indexOf("//") === 0) value = "https:" + value;
  if (value.indexOf("http://") === 0) value = "https://" + value.slice(7);
  if (value.indexOf("https://") !== 0) return undefined;
  if (value.length > 400) return undefined;
  return value;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const id = env.ARCADE.idFromName("desk");
    return env.ARCADE.get(id).fetch(request);
  },
};

export class ArcadeRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/ws") {
      const secret =
        url.searchParams.get("secret") ||
        (request.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!this.env.SHARED_SECRET || secret !== this.env.SHARED_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "hello" }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/event" && request.method === "POST") {
      let body;
      try {
        const raw = await request.text();
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return cors(JSON.stringify({ error: "invalid json" }), 400);
      }
      const secret =
        (body && body.secret) ||
        url.searchParams.get("secret") ||
        (request.headers.get("Authorization") || "").replace("Bearer ", "");
      if (!this.env.SHARED_SECRET || secret !== this.env.SHARED_SECRET) {
        return cors(JSON.stringify({ error: "unauthorized" }), 401);
      }
      if (!body || !body.type || !body.sessionId) {
        return cors(JSON.stringify({ error: "need type and sessionId" }), 400);
      }
      const cf = request.cf || {};
      const payload = JSON.stringify({
        sessionId: String(body.sessionId).slice(0, 80),
        type: String(body.type).slice(0, 32),
        productTitle: body.productTitle
          ? String(body.productTitle).slice(0, 80)
          : undefined,
        total: body.total ? String(body.total).slice(0, 24) : undefined,
        firstName: body.firstName
          ? String(body.firstName).slice(0, 40)
          : undefined,
        lastName: body.lastName
          ? String(body.lastName).slice(0, 40)
          : undefined,
        productType: body.productType
          ? String(body.productType).slice(0, 40)
          : undefined,
        imageUrl: sanitizeImageUrl(body.imageUrl),
        pageUrl: body.pageUrl ? String(body.pageUrl).slice(0, 200) : undefined,
        pageTitle: body.pageTitle
          ? String(body.pageTitle).slice(0, 80)
          : undefined,
        city: cf.city ? String(cf.city).slice(0, 40) : undefined,
        region: cf.region ? String(cf.region).slice(0, 40) : undefined,
        regionCode: cf.regionCode ? String(cf.regionCode).slice(0, 8) : undefined,
        country: cf.country ? String(cf.country).slice(0, 4) : undefined,
      });
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          /* socket already gone */
        }
      }
      return cors(JSON.stringify({ ok: true }));
    }

    return new Response("sale-arcade relay", { headers: corsHeaders });
  }

  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}
