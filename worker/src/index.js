function sanitizeImageUrl(url) {
  if (!url) return undefined;
  let value = String(url).trim();
  if (value.indexOf("//") === 0) value = "https:" + value;
  if (value.indexOf("http://") === 0) value = "https://" + value.slice(7);
  if (value.indexOf("https://") !== 0) return undefined;
  if (value.length > 400) return undefined;
  return value;
}

function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return undefined;
  const items = [];
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const rawTitle = row.productTitle || row.title;
    const productTitle = rawTitle ? String(rawTitle).slice(0, 80) : "";
    const imageUrl = sanitizeImageUrl(row.imageUrl);
    if (!productTitle && !imageUrl) continue;
    const qty = Number(row.quantity || row.qty);
    items.push({
      productTitle: productTitle || undefined,
      productType: row.productType
        ? String(row.productType).slice(0, 40)
        : undefined,
      imageUrl,
      quantity: Number.isFinite(qty) ? Math.min(99, Math.max(1, qty)) : 1,
    });
  }
  return items;
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

function normalizePlace(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isHiddenLocation(cf) {
  if (!cf) return false;
  if (normalizePlace(cf.city) !== "council bluffs") return false;
  const region = normalizePlace(cf.region);
  const code = String(cf.regionCode || "").toUpperCase();
  const country = String(cf.country || "").toUpperCase();
  if (code === "IA" || region === "iowa" || region === "ia") return true;
  return !code && !region && (country === "US" || !country);
}

const STORE_HOSTS = ["joshzandman.com", "joshzandman.myshopify.com"];
const PRESENCE_TYPES = { enter: true, heartbeat: true, leave: true };

function fromStorefront(request) {
  const origin = (request.headers.get("Origin") || "").toLowerCase();
  const referer = (request.headers.get("Referer") || "").toLowerCase();
  return STORE_HOSTS.some(
    (host) => origin.indexOf(host) >= 0 || referer.indexOf(host) >= 0
  );
}

async function clientKey(request) {
  try {
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim();
    const ua = request.headers.get("User-Agent") || "";
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${ip}|${ua}`)
    );
    const bytes = new Uint8Array(buf);
    let out = "";
    for (let i = 0; i < 8; i += 1) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  } catch {
    return undefined;
  }
}

import { BEACON_JS } from "./beacon.js";

function beaconResponse() {
  return new Response(BEACON_JS, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/beacon.js") return beaconResponse();
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
      if (!body || !body.type || !body.sessionId) {
        return cors(JSON.stringify({ error: "need type and sessionId" }), 400);
      }
      const authed = this.env.SHARED_SECRET && secret === this.env.SHARED_SECRET;
      const presence = PRESENCE_TYPES[String(body.type)];
      if (!authed && !presence) {
        return cors(JSON.stringify({ error: "unauthorized" }), 401);
      }
      const cf = request.cf || {};
      if (isHiddenLocation(cf)) {
        return cors(JSON.stringify({ ok: true }));
      }
      const key = await clientKey(request);
      const payload = JSON.stringify({
        sessionId: String(body.sessionId).slice(0, 80),
        clientKey: key,
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
        collectionTitle: body.collectionTitle
          ? String(body.collectionTitle).slice(0, 80)
          : undefined,
        quantity: body.quantity ? Number(body.quantity) || undefined : undefined,
        totalQuantity:
          body.totalQuantity === undefined || body.totalQuantity === null
            ? undefined
            : Number(body.totalQuantity),
        items: sanitizeItems(body.items),
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
