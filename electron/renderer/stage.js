const MAX_NPCS = 6;
const IDLE_MS = 25000;
const NPC_H = 140;
const DOOR_H = 196;
const WALK_SPEED = 130;
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
let cssW = window.innerWidth;
let cssH = window.innerHeight;
let stage = { left: 0, top: 0, width: cssW, height: cssH };

const npcs = new Map();
const waiting = [];
const pendingCart = new Set();
const pendingName = new Map();
const pendingItems = new Map();
const imageCache = new Map();
let sprites = null;
let rockets = [];
let caption = null;
let door = { phase: "closed", t: 0 };
let doorHold = 0;
let last = performance.now();
let muted = false;
let settings = {
  landmark: "door",
  storeName: "Zandman's Magic Shop",
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

function applyLayout(data) {
  if (!data || !data.work) return;
  stage = {
    left: data.work.x,
    top: data.work.y,
    width: data.work.width,
    height: data.work.height,
  };
}

function applySettings(data) {
  if (!data) return;
  if (data.landmark === "street" || data.landmark === "door") {
    settings.landmark = data.landmark;
  }
  if (data.storeName) {
    settings.storeName = String(data.storeName).slice(0, 40);
  }
}

function splitSignLines(name) {
  const words = String(name || "STORE")
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return ["STORE", ""];
  if (words.length === 1) return [words[0], ""];
  if (words.length === 2) return [words[0], words[1]];
  if (words.length === 3) return [words[0], `${words[1]} ${words[2]}`];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

function groundY() {
  return stage.top + stage.height - 22;
}

function doorWidth() {
  if (!sprites || !sprites.doorClosed) return 140;
  const closed = (sprites.doorClosed.sw / sprites.doorClosed.sh) * DOOR_H;
  const open = sprites.doorOpen
    ? (sprites.doorOpen.sw / sprites.doorOpen.sh) * DOOR_H
    : closed;
  return Math.max(closed, open);
}

function streetSignWidth() {
  const [line1, line2] = splitSignLines(settings.storeName);
  const longest = Math.max(line1.length, line2.length || 0);
  return Math.min(stage.width * 0.45, Math.max(130, longest * 12 + 36));
}

function landmarkWidth() {
  if (settings.landmark === "street") return streetSignWidth();
  return doorWidth();
}

function doorX() {
  return stage.left + stage.width - landmarkWidth() - 18;
}

function stageLeft() {
  return stage.left + 28;
}

function stageRight() {
  return Math.max(stageLeft() + 40, doorX() - 16);
}

function slotX(index) {
  const left = stageLeft();
  const right = stageRight();
  const span = Math.max(120, right - left);
  return left + ((index + 0.5) * span) / MAX_NPCS;
}

function nextSlot() {
  const used = new Set([...npcs.values()].map((n) => n.slot));
  for (let i = 0; i < MAX_NPCS; i += 1) if (!used.has(i)) return i;
  return 0;
}

function reportCount() {
  if (window.arcade) window.arcade.sendCount(npcs.size);
}

function cleanNamePart(value) {
  return String(value || "")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .trim();
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

function loadProductImage(url) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function addCartItem(npc, payload) {
  if (!npc) return;
  if (!npc.items) npc.items = [];
  const title = (payload && payload.productTitle) || "";
  const imageUrl =
    (payload && (payload.imageDataUrl || payload.imageUrl)) || "";
  const productType = (payload && payload.productType) || "";
  if (!title && !imageUrl) return;
  const item = { title, imageUrl, productType, img: null };
  npc.items.push(item);
  if (npc.items.length > 8) npc.items.shift();
  loadProductImage(imageUrl).then((img) => {
    item.img = img;
  });
}

function removeCartItem(npc, payload) {
  if (!npc || !npc.items || !npc.items.length) return;
  const title = payload && payload.productTitle;
  let idx = -1;
  if (title) {
    idx = npc.items.findIndex((it) => it.title === title);
  }
  if (idx === -1) idx = npc.items.length - 1;
  npc.items.splice(idx, 1);
  if (!npc.items.length) {
    npc.hadCart = false;
    if (npc.state === "cart") npc.state = "idle";
  }
}

function openDoor() {
  if (settings.landmark !== "door") return;
  if (door.phase === "closed") {
    door.phase = "opening";
    door.t = 0;
    ArcadeAudio.door();
  }
  doorHold = 0.9;
}

function handleEvent(payload) {
  if (!payload) return;
  if (payload.type === "mute") {
    muted = Boolean(payload.muted);
    ArcadeAudio.setMuted(muted);
    return;
  }
  if (payload.type === "hello") return;
  if (payload.type === "clear") {
    npcs.clear();
    waiting.length = 0;
    pendingCart.clear();
    pendingName.clear();
    pendingItems.clear();
    reportCount();
    return;
  }

  const id = payload.sessionId || "anon";
  if (payload.type === "enter") {
    spawnOrRefresh(id, payload);
    return;
  }
  if (payload.type === "heartbeat") {
    const npc = npcs.get(id);
    if (npc && npc.state !== "leaving") {
      npc.lastEvent = Date.now();
      applyName(npc, payload);
    }
    return;
  }
  if (payload.type === "cart") {
    let npc = npcs.get(id);
    if (!npc) npc = spawnOrRefresh(id, payload);
    if (!npc || !npcs.has(id)) {
      pendingCart.add(id);
      if (payload.firstName) pendingName.set(id, payload.firstName);
      const queued = pendingItems.get(id) || [];
      queued.push(payload);
      pendingItems.set(id, queued);
      return;
    }
    applyName(npc, payload);
    npc.hadCart = true;
    npc.productTitle = payload.productTitle || npc.productTitle;
    npc.lastEvent = Date.now();
    npc.facing = npc.facing || -1;
    if (payload.productTitle || payload.imageUrl) addCartItem(npc, payload);
    if (npc.state !== "entering" && npc.state !== "celebrating" && npc.state !== "leaving") {
      npc.state = "cart";
    }
    ArcadeAudio.cart();
    return;
  }
  if (payload.type === "cart_remove") {
    const npc = npcs.get(id);
    if (npc) {
      npc.lastEvent = Date.now();
      removeCartItem(npc, payload);
    }
    return;
  }
  if (payload.type === "cart_empty") {
    const npc = npcs.get(id);
    if (npc) {
      npc.items = [];
      npc.hadCart = false;
      if (npc.state === "cart") npc.state = "idle";
    }
    return;
  }
  if (payload.type === "purchase") {
    purchase(id, payload);
  }
  if (payload.type === "leave") {
    const npc = npcs.get(id);
    if (npc) npc.state = "leaving";
  }
}

function spawnOrRefresh(id, payload) {
  const existing = npcs.get(id);
  if (existing) {
    existing.lastEvent = Date.now();
    applyName(existing, payload);
    if (
      existing.state === "leaving" &&
      payload &&
      (payload.type === "enter" || payload.type === "cart")
    ) {
      existing.state = payload.type === "cart" || existing.hadCart ? "cart" : "idle";
    }
    return existing;
  }
  if (npcs.size >= MAX_NPCS) {
    if (!waiting.includes(id)) waiting.push(id);
    if (payload && payload.firstName) pendingName.set(id, payload.firstName);
    return { state: "queued" };
  }
  const slot = nextSlot();
  const npc = {
    id,
    slot,
    state: "entering",
    x: doorX() + 10,
    targetX: slotX(slot),
    facing: -1,
    lastEvent: Date.now(),
    bob: 0,
    hadCart: false,
    look: "side",
    browseT: 0,
    browseTarget: null,
    items: [],
  };
  npcs.set(id, npc);
  applyName(npc, payload);
  if (pendingName.has(id)) {
    applyName(npc, { firstName: pendingName.get(id) });
    pendingName.delete(id);
  }
  if (pendingCart.has(id)) {
    npc.hadCart = true;
    pendingCart.delete(id);
  }
  if (pendingItems.has(id)) {
    pendingItems.get(id).forEach((item) => addCartItem(npc, item));
    pendingItems.delete(id);
  }
  openDoor();
  reportCount();
  return npc;
}

function purchase(id, payload) {
  let npc = npcs.get(id);
  if (!npc) {
    if (npcs.size >= MAX_NPCS) {
      npc = [...npcs.values()][0];
    } else {
      npc = spawnOrRefresh(id);
      if (npcs.has(id)) npc.x = slotX(npc.slot);
    }
  }
  if (npc && npcs.has(npc.id)) {
    applyName(npc, payload);
    npc.state = "celebrating";
    npc.celebT = 0;
    npc.total = payload.total;
    npc.productTitle = payload.productTitle || npc.productTitle;
    npc.lastEvent = Date.now();
  }
  const amount = payload.total ? `$${payload.total}` : "SALE";
  const title = (payload.productTitle || "ORDER").slice(0, 18);
  caption = { text: `${amount} - ${title}`, t: 0 };
  const originX = (npc && npc.x) || cssW / 2;
  const originY = groundY() - 220;
  rockets = rockets.concat(spawnFireworks(12, originX, originY));
  ArcadeAudio.boom();
}

function admitWaiting() {
  while (waiting.length && npcs.size < MAX_NPCS) {
    spawnOrRefresh(waiting.shift());
  }
}

function stepNpc(npc, dt) {
  const moving =
    npc.state === "entering" ||
    npc.state === "leaving" ||
    npc.state === "cart";

  if (npc.state === "entering") {
    npc.facing = -1;
    npc.x -= WALK_SPEED * dt;
    if (npc.x <= npc.targetX) {
      npc.x = npc.targetX;
      npc.state = npc.hadCart ? "cart" : "idle";
    }
  } else if (npc.state === "idle") {
    npc.browseT = (npc.browseT || 0) + dt;
    const t = npc.browseT % 8;
    const left = stageLeft();
    const right = stageRight();
    npc.x = Math.min(right, Math.max(left, npc.x));
    if (t < 1.8) {
      npc.look = "up";
      npc.bob = 0;
    } else if (t < 2.7) {
      npc.look = "side";
      npc.facing = -1;
      npc.bob = 0;
    } else if (t < 3.6) {
      npc.look = "side";
      npc.facing = 1;
      npc.bob = 0;
    } else {
      npc.look = "side";
      if (npc.browseTarget == null) {
        npc.browseTarget = left + Math.random() * Math.max(8, right - left);
      }
      const gap = npc.browseTarget - npc.x;
      if (Math.abs(gap) > 3) {
        npc.facing = Math.sign(gap);
        npc.x += npc.facing * 38 * dt;
        npc.bob = Math.abs(Math.sin(performance.now() / 90)) * 4;
      } else {
        npc.browseTarget = null;
        npc.bob = 0;
      }
    }
  } else if (npc.state === "cart") {
    npc.hadCart = true;
    const left = stageLeft();
    const right = stageRight();
    npc.x += npc.facing * 70 * dt;
    if (npc.x < left) {
      npc.x = left;
      npc.facing = 1;
    }
    if (npc.x > right) {
      npc.x = right;
      npc.facing = -1;
    }
  } else if (npc.state === "celebrating") {
    npc.celebT += dt;
    if (npc.celebT > 2.6) {
      npc.state = "idle";
      npc.look = "up";
    }
  } else if (npc.state === "leaving") {
    npc.facing = 1;
    npc.x += WALK_SPEED * dt;
    if (npc.x > doorX() - 20) openDoor();
    if (npc.x >= doorX() + 4) {
      npcs.delete(npc.id);
      reportCount();
      admitWaiting();
      return;
    }
  }

  if (Date.now() - npc.lastEvent > IDLE_MS && npc.state !== "leaving") {
    npc.state = "leaving";
    npc.targetX = doorX() + 8;
  }

  if (npc.state !== "idle") {
    npc.look = "side";
    npc.browseTarget = null;
    npc.bob = moving ? Math.abs(Math.sin(performance.now() / 90)) * 4 : 0;
  }
}

function stepDoor(dt) {
  if (door.phase === "opening") {
    door.t += dt * 3.2;
    if (door.t >= 1) {
      door.t = 1;
      door.phase = "open";
    }
  } else if (door.phase === "open") {
    doorHold -= dt;
    if (doorHold <= 0) {
      door.phase = "closing";
    }
  } else if (door.phase === "closing") {
    door.t -= dt * 3.2;
    if (door.t <= 0) {
      door.t = 0;
      door.phase = "closed";
    }
  }
}

function drawSidewalk() {
  const y = groundY() - 4;
  const brickW = 32;
  const brickH = 13;
  const x0 = stage.left;
  const w = stage.width;
  ctx.fillStyle = "rgba(8,6,12,0.45)";
  ctx.fillRect(x0, y - 8, w, 34);
  for (let row = 0; row < 2; row += 1) {
    const off = (row % 2) * (brickW / 2);
    for (let x = x0 - brickW; x < x0 + w + brickW; x += brickW) {
      ctx.fillStyle = row === 0 ? "#7a757c" : "#4e4a52";
      ctx.fillRect(Math.round(x + off), y + row * brickH, brickW - 2, brickH - 2);
      ctx.fillStyle = "#9a959c";
      ctx.fillRect(Math.round(x + off), y + row * brickH, brickW - 2, 2);
    }
  }
}

function drawDoorSign(doorLeft, doorTop, faceWidth, doorH) {
  const [line1, line2] = splitSignLines(settings.storeName);
  let scale = faceWidth >= 150 ? 2 : 1;
  let w1 = line1.length * 6 * scale;
  let w2 = line2.length * 6 * scale;
  const pad = 4 * scale;
  let signW = Math.max(w1, w2) + pad * 2;
  if (signW > faceWidth - 12) {
    scale = 1;
    w1 = line1.length * 6 * scale;
    w2 = line2.length * 6 * scale;
    signW = Math.max(w1, w2) + 8;
  }
  const signH = 7 * scale * 2 + 6 * scale;
  const sx = Math.round(doorLeft + faceWidth / 2 - signW / 2);
  const sy = Math.round(doorTop + doorH * 0.62);
  ctx.fillStyle = "#2a1408";
  ctx.fillRect(sx - 2, sy - 2, signW + 4, signH + 4);
  ctx.fillStyle = "#c4a35a";
  ctx.fillRect(sx, sy, signW, signH);
  ctx.fillStyle = "#8a6a2a";
  ctx.fillRect(sx, sy, signW, 2);
  ctx.fillRect(sx, sy + signH - 2, signW, 2);
  drawPixelText(
    ctx,
    line1,
    sx + Math.round((signW - w1) / 2),
    sy + 3 * scale,
    scale,
    "#3a1c08"
  );
  if (line2) {
    drawPixelText(
      ctx,
      line2,
      sx + Math.round((signW - w2) / 2),
      sy + 3 * scale + 7 * scale + 2,
      scale,
      "#3a1c08"
    );
  }
}

function drawStreetSign() {
  const [line1, line2] = splitSignLines(settings.storeName);
  const scale = Math.max(line1.length, line2.length) > 14 ? 1 : 2;
  const w1 = line1.length * 6 * scale;
  const w2 = line2 ? line2.length * 6 * scale : 0;
  const padX = 10;
  const padY = 6;
  const bladeW = Math.max(w1, w2) + padX * 2;
  const bladeH = (line2 ? 2 : 1) * (7 * scale) + padY * 2 + (line2 ? 4 : 0);
  const poleW = 8;
  const poleX = stage.left + stage.width - 22 - poleW;
  const poleBottom = groundY();
  const poleTop = poleBottom - 210;
  const bladeX = poleX - bladeW + 6;
  const bladeY = poleTop + 18;
  ctx.fillStyle = "#2b2b32";
  ctx.fillRect(poleX, poleTop, poleW, poleBottom - poleTop);
  ctx.fillStyle = "#5c5c66";
  ctx.fillRect(poleX, poleTop, 2, poleBottom - poleTop);
  ctx.fillStyle = "#1a1a20";
  ctx.fillRect(poleX - 4, poleBottom - 8, poleW + 8, 8);
  ctx.fillStyle = "#0d2a18";
  ctx.fillRect(bladeX - 2, bladeY - 2, bladeW + 4, bladeH + 4);
  ctx.fillStyle = "#1f7a44";
  ctx.fillRect(bladeX, bladeY, bladeW, bladeH);
  ctx.fillStyle = "#f4f7f2";
  ctx.fillRect(bladeX, bladeY, bladeW, 2);
  ctx.fillRect(bladeX, bladeY + bladeH - 2, bladeW, 2);
  ctx.fillRect(bladeX, bladeY, 2, bladeH);
  ctx.fillRect(bladeX + bladeW - 2, bladeY, 2, bladeH);
  drawPixelText(
    ctx,
    line1,
    bladeX + Math.round((bladeW - w1) / 2),
    bladeY + padY,
    scale,
    "#f4f7f2"
  );
  if (line2) {
    drawPixelText(
      ctx,
      line2,
      bladeX + Math.round((bladeW - w2) / 2),
      bladeY + padY + 7 * scale + 4,
      scale,
      "#f4f7f2"
    );
  }
}

function drawLandmark() {
  if (settings.landmark === "street") {
    drawStreetSign();
    return;
  }
  drawDoor();
}

function drawDoor() {
  if (!sprites) return;
  const reserved = doorWidth();
  const x = doorX();
  const y = groundY() - DOOR_H;
  const closed = door.t < 0.45;
  const spr = closed ? sprites.doorClosed : sprites.doorOpen;
  const w = (spr.sw / spr.sh) * DOOR_H;
  const dx = x + (reserved - w);
  drawSprite(ctx, spr, dx, y, DOOR_H, false);
  const faceW = closed ? w : w * 0.4;
  drawDoorSign(dx, y, faceW, DOOR_H);
}

function spriteFor(npc) {
  if (npc.state === "celebrating") return sprites.celebrate;
  if (npc.state === "cart" || (npc.hadCart && npc.state !== "idle")) return sprites.cart;
  if (npc.state === "idle" && npc.look === "up" && sprites.look) return sprites.look;
  return sprites.idle;
}

function drawBubble(npc, x, y, width) {
  if (!npc.firstName) return;
  const scale = 1;
  const text = npc.lastName
    ? `${npc.firstName} ${npc.lastName}`
    : npc.firstName;
  const gaps = (text.match(/ /g) || []).length;
  const tw = (text.length - gaps) * 6 * scale + gaps * 4 * scale;
  const padX = 5;
  const padY = 4;
  const bw = tw + padX * 2;
  const bh = 7 * scale + padY * 2;
  let bx = Math.round(x + width / 2 - bw / 2);
  let by = Math.round(y - bh - 14);
  bx = Math.max(stage.left + 4, Math.min(bx, stage.left + stage.width - bw - 4));
  by = Math.max(stage.top + 4, by);
  ctx.fillStyle = "#1a1020";
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = "#fff8e8";
  ctx.fillRect(bx, by, bw, bh);
  const tailX = Math.round(Math.min(Math.max(x + width / 2, bx + 8), bx + bw - 8));
  ctx.fillStyle = "#1a1020";
  ctx.fillRect(tailX - 4, by + bh, 8, 6);
  ctx.fillStyle = "#fff8e8";
  ctx.fillRect(tailX - 3, by + bh - 1, 6, 6);
  ctx.fillRect(tailX - 2, by + bh + 5, 4, 4);
  drawPixelText(ctx, text, bx + padX, by + padY, scale, "#2a1810");
}

function drawCartItems(npc, x, y, width, height, flip) {
  const items = npc.items || [];
  if (!items.length) return;
  const shown = items.slice(-4);
  shown.forEach((item, i) => {
    const kind = `${item.productType || ""} ${item.title || ""}`.toLowerCase();
    const isBook = /book|novel|isbn|paperback|hardcover|fiction/.test(kind);
    const iw = isBook ? 22 : 26;
    const ih = isBook ? 32 : 26;
    const localX = width * 0.62 + i * 8;
    const localY = height * 0.34 - (i % 2) * 5;
    const screenX = flip ? x + width - localX - iw : x + localX;
    const screenY = y + localY;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.translate(screenX + iw / 2, screenY + ih / 2);
    ctx.rotate(flip ? -0.1 : 0.1);
    if (item.img) {
      ctx.drawImage(item.img, -iw / 2, -ih / 2, iw, ih);
    } else {
      ctx.fillStyle = "#6b3a1f";
      ctx.fillRect(-iw / 2, -ih / 2, iw, ih);
      ctx.fillStyle = "#fff1a8";
      const letter = (item.title || "?").charAt(0).toUpperCase();
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, 0, 0);
    }
    ctx.strokeStyle = "#1a1020";
    ctx.lineWidth = 1;
    ctx.strokeRect(-iw / 2 + 0.5, -ih / 2 + 0.5, iw - 1, ih - 1);
    if (isBook) {
      ctx.fillStyle = "rgba(20,10,8,0.45)";
      ctx.fillRect(-iw / 2, -ih / 2, 3, ih);
    }
    ctx.restore();
  });
}

function drawNpc(npc) {
  if (!sprites) return;
  const spr = spriteFor(npc);
  const hop = npc.state === "celebrating" ? Math.abs(Math.sin(npc.celebT * 8)) * 14 : 0;
  const h = NPC_H;
  const width = (spr.sw / spr.sh) * h;
  const x = npc.x;
  const y = groundY() - h - npc.bob - hop;
  const flip = npc.facing < 0;
  drawSprite(ctx, spr, x, y, h, flip);
  if (npc.state === "cart" || (npc.hadCart && npc.state !== "idle" && npc.state !== "celebrating")) {
    drawCartItems(npc, x, y, width, h, flip);
  }
  drawBubble(npc, x, y, width);
  return width;
}

function drawCaption() {
  if (!caption) return;
  caption.t += 0.016;
  if (caption.t > 4.5) {
    caption = null;
    return;
  }
  const scale = 3;
  const text = caption.text;
  const w = text.length * 6 * scale;
  const x = Math.round((cssW - w) / 2);
  const y = Math.round(cssH * 0.28);
  ctx.fillStyle = "rgba(8,4,16,0.55)";
  ctx.fillRect(x - 16, y - 10, w + 32, 7 * scale + 20);
  drawPixelText(ctx, text, x, y, scale, "#fff1a8");
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stepDoor(dt);
  for (const npc of [...npcs.values()]) stepNpc(npc, dt);
  rockets = stepFireworks(rockets);

  ctx.clearRect(0, 0, cssW, cssH);
  drawSidewalk();
  drawLandmark();
  const ordered = [...npcs.values()].sort((a, b) => a.x - b.x);
  for (const npc of ordered) drawNpc(npc);
  drawFireworks(ctx, rockets);
  drawCaption();
  requestAnimationFrame(frame);
}

loadAllSprites()
  .then((loaded) => {
    sprites = loaded;
  })
  .catch((err) => {
    console.error("sprite load failed", err);
  });

if (window.arcade) {
  window.arcade.onEvent(handleEvent);
  window.arcade.onQueryCount(reportCount);
  if (window.arcade.onLayout) window.arcade.onLayout(applyLayout);
  if (window.arcade.onSettings) window.arcade.onSettings(applySettings);
}

requestAnimationFrame(frame);
