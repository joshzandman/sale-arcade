(function (root) {
  const MAX_NPCS = 6;
  const IDLE_MS = 25000;
  const CHECKOUT_IDLE_MS = 20 * 60 * 1000;
  const LEAVE_GRACE_MS = 3000;
  const WALK_SPEED = 130;
  const STROLL_SPEED = 48;
  const CART_STROLL_SPEED = 70;
  const DWELL_S = 10;
  const LANDMARKS = ["none", "door", "street", "elevator"];
  const NPC_SIZES = {
    large: 180,
    normal: 140,
    small: 100,
    tiny: 72,
  };
  const OUTFIT_COUNT = 6;
  const PRESENCE_TYPES = { enter: true, heartbeat: true, leave: true };
  const SPECULATIVE_SKIP = {
    enter: true,
    heartbeat: true,
    leave: true,
    view: true,
    browse: true,
  };

  function cleanNamePart(value) {
    return String(value || "")
      .replace(/\+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[^a-zA-Z0-9 '\-]/g, "")
      .trim();
  }

  function urlPath(url) {
    try {
      return new URL(url).pathname.split("/").filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function prettySlug(slug) {
    try {
      return decodeURIComponent(String(slug || ""))
        .replace(/-/g, " ")
        .trim();
    } catch (err) {
      return String(slug || "").replace(/-/g, " ").trim();
    }
  }

  function cleanPageTitle(title) {
    return String(title || "")
      .split(/\s+[|\-–—]\s+/)[0]
      .trim();
  }

  function shopifyPageHandle(path) {
    const i = path.findIndex((p) => String(p).toLowerCase() === "pages");
    return i >= 0 ? String(path[i + 1] || "").toLowerCase() : "";
  }

  function isAboutPage(handle, title) {
    const h = String(handle || "").toLowerCase();
    const t = String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (h === "about" || h === "about-us" || h.startsWith("about-")) return true;
    return t === "about" || t === "about us";
  }

  function cartishType(type) {
    return (
      type === "cart" ||
      type === "cart_remove" ||
      type === "cart_sync" ||
      type === "cart_empty" ||
      type === "purchase"
    );
  }

  function visitInfo(payload, npc) {
    payload = payload || {};
    const hasUrl = Boolean(payload.pageUrl);
    const path = hasUrl ? urlPath(payload.pageUrl) : [];
    const useProductTitle = payload.productTitle && !cartishType(payload.type);
    const isProduct = Boolean(useProductTitle) || path[0] === "products";
    let title = "";
    if (isProduct) {
      title = payload.productTitle || prettySlug(path[1]) || "";
    } else if (payload.collectionTitle) {
      title = String(payload.collectionTitle);
    } else if (hasUrl && !path.length) {
      title = "Home";
    } else if (path[0] === "collections" && path[1]) {
      title = prettySlug(path[1]);
    } else if (path.some((p) => String(p).toLowerCase() === "pages")) {
      const handle = shopifyPageHandle(path);
      title = payload.pageTitle
        ? cleanPageTitle(payload.pageTitle)
        : prettySlug(handle || path[path.length - 1]);
      if (!isAboutPage(handle, title)) {
        title = String(title)
          .replace(/\s+instructions$/i, "")
          .trim();
        title = title ? `${title} instructions` : "instructions";
      }
    } else if (path[0] === "cart") {
      title = "Cart";
    } else if (payload.pageTitle) {
      title = cleanPageTitle(payload.pageTitle);
    } else if (path.length) {
      title = prettySlug(path[path.length - 1]);
    }
    if (!title) {
      return npc
        ? { kind: npc.viewKind || "browsing", title: npc.viewing || "Home" }
        : { kind: "browsing", title: "Home" };
    }
    return {
      kind: isProduct ? "viewing" : "browsing",
      title: String(title).slice(0, 64),
    };
  }

  function visitorName(npc) {
    const first = npc && npc.firstName ? String(npc.firstName).trim() : "";
    const last = npc && npc.lastName ? String(npc.lastName).trim() : "";
    if (first && last) return `${first} ${last}`;
    if (first) return first;
    return "Guest";
  }

  function hoverViewLine(npc) {
    const verb = npc && npc.viewKind === "viewing" ? "viewing" : "browsing";
    const title = (npc && npc.viewing) || "Home";
    return `${visitorName(npc)} is ${verb} ${title}`;
  }

  function npcHeightFor(size) {
    return NPC_SIZES[size] || NPC_SIZES.normal;
  }

  function minNpcGap(height) {
    return Math.round((Number(height) || NPC_SIZES.normal) * 0.7) + 24;
  }

  function hashOutfit(id) {
    let h = 0;
    const s = String(id || "");
    for (let i = 0; i < s.length; i += 1) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % OUTFIT_COUNT;
  }

  function pickOutfit(id, used) {
    const preferred = hashOutfit(id);
    const taken = used instanceof Set ? used : new Set(used || []);
    if (!taken.has(preferred)) return preferred;
    for (let i = 0; i < OUTFIT_COUNT; i += 1) {
      const next = (preferred + i) % OUTFIT_COUNT;
      if (!taken.has(next)) return next;
    }
    return preferred;
  }

  function separateNpcs(list, minGap) {
    const gap = Math.max(8, Number(minGap) || 80);
    const npcs = (list || []).filter(Boolean).sort((a, b) => a.x - b.x);
    for (let i = 0; i < npcs.length - 1; i += 1) {
      const a = npcs[i];
      const b = npcs[i + 1];
      const overlap = gap - (b.x - a.x);
      if (overlap <= 0) continue;
      const aLeaving = a.state === "leaving";
      const bLeaving = b.state === "leaving";
      if (aLeaving && !bLeaving) {
        b.x += overlap;
      } else if (bLeaving && !aLeaving) {
        a.x -= overlap;
      } else {
        a.x -= overlap / 2;
        b.x += overlap / 2;
      }
    }
    return npcs;
  }

  function normalizePlace(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isHiddenLocation(loc) {
    if (!loc) return false;
    if (normalizePlace(loc.city) !== "council bluffs") return false;
    const region = normalizePlace(loc.region);
    const code = String(loc.regionCode || "").toUpperCase();
    const country = String(loc.country || "").toUpperCase();
    if (code === "IA" || region === "iowa" || region === "ia") return true;
    return !code && !region && (country === "US" || !country);
  }

  function isCheckoutPayload(payload) {
    if (!payload) return false;
    if (payload.type === "checkout" || payload.type === "purchase") return true;
    const url = String(payload.pageUrl || "").toLowerCase();
    return (
      url.indexOf("/checkout") >= 0 ||
      url.indexOf("checkouts") >= 0 ||
      url.indexOf("thank_you") >= 0
    );
  }

  function isCheckoutUrl(url) {
    const value = String(url || "").toLowerCase();
    return (
      value.indexOf("/checkout") >= 0 ||
      value.indexOf("checkouts") >= 0 ||
      value.indexOf("thank_you") >= 0
    );
  }

  function locationLabel(npc) {
    const country = String((npc && npc.country) || "").toUpperCase();
    const city = (npc && npc.city) || "";
    const region = (npc && (npc.regionCode || npc.region)) || "";
    if (country === "US") {
      const bits = [];
      if (city) bits.push(city);
      if (region) bits.push(region);
      if (bits.length) return bits.join(", ");
    }
    if (country) {
      try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country;
      } catch (err) {
        return country;
      }
    }
    return "";
  }

  function applyVisit(npc, payload) {
    if (!npc || !payload) return;
    const info = visitInfo(payload, npc);
    if (info && info.title) {
      npc.viewing = info.title;
      npc.viewKind = info.kind;
    }
    if (payload.city) npc.city = payload.city;
    if (payload.region) npc.region = payload.region;
    if (payload.regionCode) npc.regionCode = payload.regionCode;
    if (payload.country) npc.country = payload.country;
  }

  function applyName(npc, payload) {
    if (!npc || !payload) return;
    let first = cleanNamePart(payload.firstName);
    let last = cleanNamePart(payload.lastName);
    if (first && !last) {
      const parts = first.split(" ").filter(Boolean);
      if (parts.length >= 2) {
        first = parts[0];
        last = parts.slice(1).join(" ");
      }
    }
    if (first) npc.firstName = first;
    if (last) npc.lastName = last;
  }

  function hasCart(npc) {
    return Boolean(npc && npc.items && npc.items.length);
  }

  function applyCartPresence(npc) {
    if (!npc) return;
    if (npc.purchased && !hasCart(npc)) {
      npc.hadCart = false;
      if (npc.state === "cart") npc.state = "idle";
      return;
    }
    if (hasCart(npc)) {
      npc.hadCart = true;
      if (npc.state === "idle") npc.state = "cart";
    } else {
      npc.hadCart = false;
      if (npc.state === "cart") npc.state = "idle";
    }
  }

  function normalizeTitle(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function findCartItem(items, payload, loose) {
    const title = normalizeTitle(payload && payload.productTitle);
    const image = (payload && (payload.imageDataUrl || payload.imageUrl)) || "";
    if (title) {
      let idx = items.findIndex((it) => normalizeTitle(it.title) === title);
      if (idx >= 0) return idx;
      if (loose) {
        idx = items.findIndex((it) => {
          const name = normalizeTitle(it.title);
          return name && (name.indexOf(title) >= 0 || title.indexOf(name) >= 0);
        });
        if (idx >= 0) return idx;
      }
    }
    if (image) {
      const idx = items.findIndex(
        (it) => it.imageUrl === image || it.imageDataUrl === image
      );
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function addCartItem(npc, payload, loadImage) {
    if (!npc) return;
    npc.purchased = false;
    if (!npc.items) npc.items = [];
    const title = (payload && payload.productTitle) || "";
    const imageUrl =
      (payload && (payload.imageDataUrl || payload.imageUrl)) || "";
    const productType = (payload && payload.productType) || "";
    const qty = Math.max(1, Number(payload && payload.quantity) || 1);
    if (!title && !imageUrl) return;
    const idx = title ? findCartItem(npc.items, payload, false) : -1;
    if (idx >= 0) {
      const existing = npc.items[idx];
      existing.qty = (existing.qty || 1) + qty;
      if (imageUrl && !existing.img) existing.imageUrl = imageUrl;
      applyCartPresence(npc);
      return;
    }
    const item = { title, imageUrl, productType, qty, img: null };
    npc.items.push(item);
    if (npc.items.length > 8) npc.items.shift();
    if (typeof loadImage === "function" && imageUrl) {
      Promise.resolve(loadImage(imageUrl)).then((img) => {
        item.img = img;
      });
    }
    applyCartPresence(npc);
  }

  function removeCartItem(npc, payload) {
    if (!npc || !npc.items || !npc.items.length) return;
    const idx = findCartItem(npc.items, payload, true);
    if (idx < 0) {
      applyCartPresence(npc);
      return;
    }
    const item = npc.items[idx];
    item.qty = (item.qty || 1) - 1;
    if (item.qty <= 0) npc.items.splice(idx, 1);
    applyCartPresence(npc);
  }

  function replaceCartItems(npc, items, loadImage) {
    if (!npc) return;
    const prev = npc.items || [];
    npc.items = [];
    (items || []).forEach((item) => {
      addCartItem(
        npc,
        {
          productTitle: item.productTitle || item.title,
          imageUrl: item.imageDataUrl || item.imageUrl,
          productType: item.productType,
          quantity: item.quantity || item.qty || 1,
        },
        loadImage
      );
    });
    if (items && items.length && !npc.items.length) npc.items = prev;
    applyCartPresence(npc);
  }

  function applyIncomingCart(npc, payload, loadImage) {
    if (!npc || !payload || !Array.isArray(payload.items)) return;
    if (npc.purchased && payload.type !== "cart") {
      if (!payload.items.length) {
        npc.items = [];
        applyCartPresence(npc);
      }
      return;
    }
    if (!payload.items.length) return;
    replaceCartItems(npc, payload.items, loadImage);
  }

  function shouldApplyCartSync(payload) {
    const incoming = Array.isArray(payload && payload.items) ? payload.items : null;
    if (!incoming) return false;
    const totalQty = Number(payload.totalQuantity);
    if (!incoming.length && totalQty !== 0) return false;
    return true;
  }

  function keepForCheckout(npc, payload, clock) {
    if (!npc || !isCheckoutPayload(payload)) return;
    npc.checkingOut = true;
    npc.lastEvent = typeof clock === "function" ? clock() : Date.now();
    if (npc.state === "leaving") {
      npc.state = hasCart(npc) || npc.hadCart ? "cart" : "idle";
      npc.leaveT = 0;
    }
  }

  function pageIsLive(doc) {
    if (doc && doc.prerendering) return false;
    return true;
  }

  function pixelShouldSend(type, opts) {
    opts = opts || {};
    if (opts.speculative && SPECULATIVE_SKIP[type]) return false;
    if (
      opts.themeOwnsPresence &&
      !opts.onCheckout &&
      PRESENCE_TYPES[type]
    ) {
      return false;
    }
    return true;
  }

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

  function eventNeedsAuth(type) {
    return !PRESENCE_TYPES[String(type)];
  }

  function createStage(hooks) {
    hooks = hooks || {};
    const now = hooks.now || (() => Date.now());
    const loadImage = hooks.loadImage || (() => Promise.resolve(null));
    const doorX = hooks.doorX || (() => 880);
    const elevatorX = hooks.elevatorX || (() => 880);
    const slotX =
      hooks.slotX ||
      ((index) => 60 + ((index + 0.5) * 700) / MAX_NPCS);
    const elevatorReady = hooks.elevatorReady || (() => true);
    const requestLandmark = hooks.requestLandmark || (() => {});
    const onCount = hooks.onCount || (() => {});
    const onCartSound = hooks.onCartSound || (() => {});
    const onBoom = hooks.onBoom || (() => {});
    const onMute = hooks.onMute || (() => {});
    const onPurchaseFx = hooks.onPurchaseFx || (() => {});
    const getLandmark = hooks.getLandmark || (() => settings.landmark);
    const getBodyWidth = hooks.getBodyWidth || (() => minNpcGap(npcHeightFor(settings.npcSize)));
    const stageLeft = hooks.stageLeft || (() => 40);
    const stageRight = hooks.stageRight || (() => 800);

    const npcs = new Map();
    const waiting = [];
    const pendingCart = new Set();
    const pendingName = new Map();
    const pendingItems = new Map();
    const clientOwner = new Map();
    const sessionAlias = new Map();
    const settings = {
      landmark: "door",
      storeName: "Zandman's Magic Shop",
      showStage: true,
      npcSize: "normal",
    };

    function nextSlot() {
      const used = new Set([...npcs.values()].map((n) => n.slot));
      for (let i = 0; i < MAX_NPCS; i += 1) if (!used.has(i)) return i;
      return 0;
    }

    function reportCount() {
      onCount(npcs.size);
    }

    function forgetVisitor(id) {
      if (!id) return;
      const had = npcs.delete(id);
      const waitIdx = waiting.indexOf(id);
      if (waitIdx >= 0) waiting.splice(waitIdx, 1);
      pendingCart.delete(id);
      pendingName.delete(id);
      pendingItems.delete(id);
      for (const [key, owner] of [...clientOwner]) {
        if (owner === id) clientOwner.delete(key);
      }
      for (const [sid, owner] of [...sessionAlias]) {
        if (owner === id || sid === id) sessionAlias.delete(sid);
      }
      if (had) {
        reportCount();
        admitWaiting();
      }
    }

    function resolveSession(payload) {
      let sid = (payload && payload.sessionId) || "anon";
      if (sessionAlias.has(sid)) sid = sessionAlias.get(sid);
      const key = payload && payload.clientKey;
      if (key) {
        const owner = clientOwner.get(key);
        if (
          owner &&
          owner !== sid &&
          (npcs.has(owner) || waiting.indexOf(owner) >= 0)
        ) {
          sessionAlias.set((payload && payload.sessionId) || sid, owner);
          return owner;
        }
        if (!owner || !npcs.has(owner)) clientOwner.set(key, sid);
      }
      return sid;
    }

    function admitWaiting() {
      while (waiting.length && npcs.size < MAX_NPCS) {
        spawnOrRefresh(waiting.shift());
      }
    }

    function spawnOrRefresh(id, payload) {
      if (isHiddenLocation(payload)) {
        forgetVisitor(id);
        return null;
      }
      const existing = npcs.get(id);
      if (existing) {
        existing.lastEvent = now();
        existing.pendingLeave = 0;
        applyName(existing, payload);
        applyVisit(existing, payload);
        if (isHiddenLocation(existing)) {
          forgetVisitor(id);
          return null;
        }
        applyIncomingCart(existing, payload, loadImage);
        keepForCheckout(existing, payload, now);
        if (
          existing.state === "leaving" &&
          payload &&
          (payload.type === "enter" ||
            payload.type === "cart" ||
            payload.type === "checkout")
        ) {
          existing.state =
            payload.type === "cart" || existing.hadCart ? "cart" : "idle";
          existing.leaveT = 0;
        }
        return existing;
      }
      if (npcs.size >= MAX_NPCS) {
        if (!waiting.includes(id)) waiting.push(id);
        if (payload && payload.firstName) pendingName.set(id, payload.firstName);
        if (payload && Array.isArray(payload.items) && payload.items.length) {
          const queued = pendingItems.get(id) || [];
          pendingItems.set(id, queued.concat(payload.items));
        }
        return { state: "queued" };
      }
      const slot = nextSlot();
      const usedOutfits = new Set(
        [...npcs.values()].map((n) => n.outfit).filter((n) => n != null)
      );
      const npc = {
        id,
        slot,
        outfit: pickOutfit(id, usedOutfits),
        state: "entering",
        x: getLandmark() === "elevator" ? elevatorX() + 18 : doorX() + 10,
        targetX: slotX(slot),
        facing: -1,
        lastEvent: now(),
        bob: 0,
        hadCart: false,
        look: "side",
        browseT: 0,
        browseTarget: null,
        idleMode: "dwell",
        dwellT: Math.random() * 2,
        dwellFor: DWELL_S + Math.random() * 2,
        items: [],
        disembarked: false,
      };
      npcs.set(id, npc);
      applyName(npc, payload);
      applyVisit(npc, payload);
      applyIncomingCart(npc, payload, loadImage);
      keepForCheckout(npc, payload, now);
      if (pendingName.has(id)) {
        applyName(npc, { firstName: pendingName.get(id) });
        pendingName.delete(id);
      }
      if (pendingCart.has(id)) {
        npc.hadCart = true;
        pendingCart.delete(id);
      }
      if (pendingItems.has(id)) {
        pendingItems.get(id).forEach((item) => addCartItem(npc, item, loadImage));
        pendingItems.delete(id);
      }
      requestLandmark();
      reportCount();
      return npc;
    }

    function findPurchaseNpc(id, payload) {
      if (id && npcs.has(id)) return npcs.get(id);
      const live = [...npcs.values()].filter((n) => n.state !== "leaving");
      const checking = live.filter((n) => n.checkingOut);
      if (checking.length) {
        return checking.sort((a, b) => b.lastEvent - a.lastEvent)[0];
      }
      if (payload && payload.firstName) {
        const first = cleanNamePart(String(payload.firstName).split(" ")[0]).toLowerCase();
        const named = live.filter(
          (n) => n.firstName && n.firstName.toLowerCase() === first
        );
        if (named.length) return named.sort((a, b) => b.lastEvent - a.lastEvent)[0];
      }
      const carts = live.filter((n) => hasCart(n) || n.state === "cart" || n.hadCart);
      if (carts.length) return carts.sort((a, b) => b.lastEvent - a.lastEvent)[0];
      if (live.length === 1) return live[0];
      return null;
    }

    function purchase(id, payload) {
      let npc = findPurchaseNpc(id, payload);
      if (!npc) {
        npc = spawnOrRefresh(id, payload);
        if (npc && npcs.has(id)) npc.x = slotX(npc.slot);
      } else if (payload && payload.sessionId && payload.sessionId !== npc.id) {
        sessionAlias.set(payload.sessionId, npc.id);
        if (id && id !== npc.id) sessionAlias.set(id, npc.id);
      }
      if (npc && npcs.has(npc.id)) {
        applyName(npc, payload);
        applyVisit(npc, payload);
        npc.items = [];
        npc.hadCart = false;
        npc.purchased = true;
        npc.pendingLeave = 0;
        npc.checkingOut = true;
        npc.state = "celebrating";
        npc.celebT = 0;
        npc.total = payload.total;
        npc.productTitle = payload.productTitle || npc.productTitle;
        npc.lastEvent = now();
        npc.leaveT = 0;
      }
      onBoom();
      onPurchaseFx(npc, payload);
      return npc;
    }

    function handleEvent(payload) {
      if (!payload) return;
      if (payload.type === "mute") {
        onMute(Boolean(payload.muted));
        return;
      }
      if (payload.type === "hello") return;
      if (payload.type === "clear") {
        npcs.clear();
        waiting.length = 0;
        pendingCart.clear();
        pendingName.clear();
        pendingItems.clear();
        clientOwner.clear();
        sessionAlias.clear();
        reportCount();
        return;
      }

      const id = resolveSession(payload);
      if (isHiddenLocation(payload)) {
        forgetVisitor(id);
        return;
      }
      if (payload.type === "enter") {
        const npc = spawnOrRefresh(id, payload);
        if (npc && npcs.has(id)) {
          npc.pendingLeave = 0;
          keepForCheckout(npc, payload, now);
        }
        return;
      }
      if (payload.type === "view" || payload.type === "browse") {
        const npc = npcs.get(id);
        if (npc && npcs.has(id)) {
          npc.lastEvent = now();
          npc.pendingLeave = 0;
          applyName(npc, payload);
          applyVisit(npc, payload);
          if (isHiddenLocation(npc)) forgetVisitor(id);
        }
        return;
      }
      if (payload.type === "heartbeat") {
        const npc = npcs.get(id);
        if (npc && npc.state !== "leaving") {
          npc.lastEvent = now();
          npc.pendingLeave = 0;
          applyName(npc, payload);
          applyVisit(npc, payload);
          applyIncomingCart(npc, payload, loadImage);
          keepForCheckout(npc, payload, now);
          if (isHiddenLocation(npc)) forgetVisitor(id);
        }
        return;
      }
      if (payload.type === "checkout") {
        const npc = npcs.get(id) || spawnOrRefresh(id, payload);
        if (npc && npcs.has(id)) {
          applyName(npc, payload);
          applyVisit(npc, payload);
          applyIncomingCart(npc, payload, loadImage);
          keepForCheckout(npc, payload, now);
        }
        return;
      }
      if (payload.type === "cart") {
        let npc = npcs.get(id);
        if (!npc) npc = spawnOrRefresh(id, payload);
        if (!npc) return;
        if (!npcs.has(id)) {
          pendingCart.add(id);
          if (payload.firstName) pendingName.set(id, payload.firstName);
          const queued = pendingItems.get(id) || [];
          queued.push(payload);
          pendingItems.set(id, queued);
          return;
        }
        applyName(npc, payload);
        applyVisit(npc, payload);
        npc.pendingLeave = 0;
        npc.hadCart = true;
        npc.productTitle = payload.productTitle || npc.productTitle;
        npc.lastEvent = now();
        npc.facing = npc.facing || -1;
        if (payload.productTitle || payload.imageUrl) addCartItem(npc, payload, loadImage);
        if (
          npc.state !== "entering" &&
          npc.state !== "celebrating" &&
          npc.state !== "leaving"
        ) {
          npc.state = "cart";
        }
        onCartSound();
        return;
      }
      if (payload.type === "cart_remove") {
        const npc = npcs.get(id);
        if (npc) {
          npc.lastEvent = now();
          applyVisit(npc, payload);
          removeCartItem(npc, payload);
        }
        return;
      }
      if (payload.type === "cart_sync") {
        let npc = npcs.get(id);
        if (!npc) npc = spawnOrRefresh(id, payload);
        if (npc && npcs.has(id)) {
          npc.lastEvent = now();
          applyName(npc, payload);
          applyVisit(npc, payload);
          if (isHiddenLocation(npc)) {
            forgetVisitor(id);
            return;
          }
          if (!shouldApplyCartSync(payload)) return;
          replaceCartItems(npc, payload.items, loadImage);
        }
        return;
      }
      if (payload.type === "cart_empty") {
        const npc = npcs.get(id);
        if (npc) {
          npc.items = [];
          applyCartPresence(npc);
        }
        return;
      }
      if (payload.type === "purchase") {
        purchase(id, payload);
      }
      if (payload.type === "leave") {
        const npc = npcs.get(id);
        if (npc && npc.checkingOut) {
          npc.lastEvent = now();
          npc.pendingLeave = 0;
          return;
        }
        if (npc && npc.state !== "leaving") npc.pendingLeave = now();
      }
    }

    function stepNpc(npc, dt) {
      if (npc.state === "entering") {
        npc.facing = -1;
        const waitingOnLift =
          getLandmark() === "elevator" && !npc.disembarked && !elevatorReady();
        if (waitingOnLift) {
          npc.x = elevatorX() + 18;
          requestLandmark();
        } else {
          if (getLandmark() === "elevator" && elevatorReady()) {
            npc.disembarked = true;
          }
          const nextX = npc.x - WALK_SPEED * dt;
          let blocked = false;
          const gap = getBodyWidth();
          for (const other of npcs.values()) {
            if (other === npc) continue;
            if (other.x < npc.x && npc.x - other.x < gap) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            npc.x = nextX;
            npc.bob = Math.abs(Math.sin(now() / 90)) * 4;
          }
          if (npc.x <= npc.targetX) {
            npc.x = npc.targetX;
            npc.state = npc.hadCart ? "cart" : "idle";
            npc.idleMode = "dwell";
            npc.dwellT = 0;
            npc.dwellFor = DWELL_S + Math.random() * 2;
            npc.look = "up";
            npc.bob = 0;
          }
        }
      } else if (npc.state === "idle" || npc.state === "cart") {
        stepRoam(npc, dt, npc.state === "cart" ? CART_STROLL_SPEED : STROLL_SPEED);
      } else if (npc.state === "celebrating") {
        npc.celebT = (npc.celebT || 0) + dt;
        if (npc.celebT > 2.6) {
          npc.state = "idle";
          npc.look = "up";
          npc.idleMode = "dwell";
          npc.dwellT = 0;
          npc.dwellFor = DWELL_S + Math.random() * 2;
          npc.bob = 0;
        }
      } else if (npc.state === "leaving") {
        npc.facing = 1;
        npc.leaveT = (npc.leaveT || 0) + dt;
        if (getLandmark() === "elevator") {
          const cabin = elevatorX() + 10;
          if (npc.x > cabin - 28) requestLandmark();
          if (!elevatorReady() && npc.x >= cabin - 12) {
            npc.x = cabin - 12;
          } else {
            npc.x += WALK_SPEED * dt;
          }
          if (elevatorReady() && npc.x >= cabin + 16) {
            npcs.delete(npc.id);
            reportCount();
            admitWaiting();
            return;
          }
        } else {
          npc.x += WALK_SPEED * dt;
          if (npc.x > doorX() - 20) requestLandmark();
          if (npc.x >= doorX() + 4) {
            npcs.delete(npc.id);
            reportCount();
            admitWaiting();
            return;
          }
        }
        if (npc.leaveT > 10) {
          npcs.delete(npc.id);
          reportCount();
          admitWaiting();
          return;
        }
      }

      if (
        npc.pendingLeave &&
        now() - npc.pendingLeave > LEAVE_GRACE_MS &&
        npc.state !== "leaving" &&
        !npc.checkingOut
      ) {
        npc.state = "leaving";
        npc.leaveT = 0;
        npc.pendingLeave = 0;
        npc.targetX = doorX() + 8;
      }

      const idleMs = npc.checkingOut ? CHECKOUT_IDLE_MS : IDLE_MS;
      if (now() - npc.lastEvent > idleMs && npc.state !== "leaving") {
        npc.state = "leaving";
        npc.leaveT = 0;
        npc.checkingOut = false;
        npc.targetX = doorX() + 8;
      }

      if (npc.state === "entering" || npc.state === "leaving") {
        npc.look = "side";
        npc.browseTarget = null;
        npc.idleMode = null;
        if (npc.state === "leaving") {
          npc.bob = Math.abs(Math.sin(now() / 90)) * 4;
        }
      }
    }

    function pickWalkTarget(npc) {
      const left = stageLeft();
      const right = stageRight();
      const span = Math.max(8, right - left);
      const gap = getBodyWidth();
      const others = [...npcs.values()]
        .filter((other) => other !== npc)
        .map((other) => other.x);
      for (let i = 0; i < 8; i += 1) {
        const x = left + Math.random() * span;
        if (others.every((ox) => Math.abs(ox - x) >= gap * 0.75)) return x;
      }
      return left + Math.random() * span;
    }

    function stepRoam(npc, dt, walkSpeed) {
      const left = stageLeft();
      const right = stageRight();
      npc.x = Math.min(right, Math.max(left, npc.x));
      const dwellFor = npc.dwellFor || DWELL_S;
      if (npc.idleMode !== "walk") {
        npc.idleMode = "dwell";
        npc.dwellT = (npc.dwellT || 0) + dt;
        const t = npc.dwellT % dwellFor;
        if (npc.state === "idle") {
          if (t < dwellFor * 0.25 || t >= dwellFor * 0.75) npc.look = "up";
          else {
            npc.look = "side";
            npc.facing = t < dwellFor * 0.5 ? -1 : 1;
          }
        } else {
          npc.look = "side";
        }
        npc.bob = 0;
        if (npc.dwellT >= dwellFor) {
          npc.idleMode = "walk";
          npc.dwellT = 0;
          npc.look = "side";
          npc.browseTarget = pickWalkTarget(npc);
        }
        return;
      }
      npc.look = "side";
      if (npc.browseTarget == null) npc.browseTarget = pickWalkTarget(npc);
      const gap = npc.browseTarget - npc.x;
      if (Math.abs(gap) > 4) {
        const dir = Math.sign(gap);
        const nextX = npc.x + dir * walkSpeed * dt;
        let blocked = false;
        const body = getBodyWidth();
        for (const other of npcs.values()) {
          if (other === npc) continue;
          if (dir < 0 && other.x < npc.x && npc.x - other.x < body) blocked = true;
          if (dir > 0 && other.x > npc.x && other.x - npc.x < body) blocked = true;
        }
        if (!blocked) {
          npc.facing = dir;
          npc.x = nextX;
          npc.bob = Math.abs(Math.sin(now() / 90)) * 4;
        } else {
          npc.idleMode = "dwell";
          npc.dwellT = 0;
          npc.dwellFor = DWELL_S + Math.random() * 2;
          npc.browseTarget = null;
          npc.bob = 0;
        }
      } else {
        npc.x = npc.browseTarget;
        npc.browseTarget = null;
        npc.idleMode = "dwell";
        npc.dwellT = 0;
        npc.dwellFor = DWELL_S + Math.random() * 2;
        npc.bob = 0;
      }
    }

    function step(dt) {
      for (const npc of [...npcs.values()]) stepNpc(npc, dt);
      separateNpcs([...npcs.values()], getBodyWidth());
      const left = stageLeft();
      const right = stageRight();
      for (const npc of npcs.values()) {
        if (npc.state === "entering" || npc.state === "leaving") continue;
        npc.x = Math.min(right, Math.max(left, npc.x));
      }
    }

    function applySettings(data) {
      if (!data) return;
      if (LANDMARKS.indexOf(data.landmark) >= 0) settings.landmark = data.landmark;
      if (data.storeName) settings.storeName = String(data.storeName).slice(0, 40);
      if (typeof data.showStage === "boolean") settings.showStage = data.showStage;
      if (NPC_SIZES[data.npcSize]) settings.npcSize = data.npcSize;
    }

    return {
      npcs,
      waiting,
      settings,
      handleEvent,
      step,
      spawnOrRefresh,
      applySettings,
      forgetVisitor,
    };
  }

  const api = {
    MAX_NPCS,
    IDLE_MS,
    CHECKOUT_IDLE_MS,
    LEAVE_GRACE_MS,
    DWELL_S,
    LANDMARKS,
    NPC_SIZES,
    OUTFIT_COUNT,
    PRESENCE_TYPES,
    cleanNamePart,
    urlPath,
    prettySlug,
    cleanPageTitle,
    shopifyPageHandle,
    isAboutPage,
    cartishType,
    visitInfo,
    hoverViewLine,
    visitorName,
    npcHeightFor,
    minNpcGap,
    hashOutfit,
    pickOutfit,
    separateNpcs,
    normalizePlace,
    isHiddenLocation,
    isCheckoutPayload,
    isCheckoutUrl,
    locationLabel,
    applyVisit,
    applyName,
    hasCart,
    applyCartPresence,
    addCartItem,
    removeCartItem,
    replaceCartItems,
    applyIncomingCart,
    shouldApplyCartSync,
    keepForCheckout,
    pageIsLive,
    pixelShouldSend,
    sanitizeImageUrl,
    sanitizeItems,
    eventNeedsAuth,
    createStage,
  };

  root.SaleArcade = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
