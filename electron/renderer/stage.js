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
let sprites = null;
let rockets = [];
let caption = null;
let door = { phase: "closed", t: 0 };
let doorHold = 0;
let last = performance.now();
let muted = false;

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

function doorX() {
  return stage.left + stage.width - doorWidth() - 18;
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

function applyName(npc, payload) {
  if (!npc || !payload || !payload.firstName) return;
  const clean = String(payload.firstName)
    .replace(/[^a-zA-Z0-9 '\-]/g, "")
    .trim()
    .slice(0, 14);
  if (clean) npc.firstName = clean;
}

function openDoor() {
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

  const id = payload.sessionId || "anon";
  if (payload.type === "enter") {
    spawnOrRefresh(id, payload);
    return;
  }
  if (payload.type === "heartbeat") {
    const npc = npcs.get(id);
    if (npc) {
      npc.lastEvent = Date.now();
      applyName(npc, payload);
    } else spawnOrRefresh(id, payload);
    return;
  }
  if (payload.type === "cart") {
    let npc = npcs.get(id);
    if (!npc) npc = spawnOrRefresh(id, payload);
    if (!npc || !npcs.has(id)) {
      pendingCart.add(id);
      if (payload.firstName) pendingName.set(id, payload.firstName);
      return;
    }
    applyName(npc, payload);
    npc.hadCart = true;
    npc.productTitle = payload.productTitle || npc.productTitle;
    npc.lastEvent = Date.now();
    npc.facing = npc.facing || -1;
    if (npc.state !== "entering" && npc.state !== "celebrating" && npc.state !== "leaving") {
      npc.state = "cart";
    }
    ArcadeAudio.cart();
    return;
  }
  if (payload.type === "cart_empty") {
    const npc = npcs.get(id);
    if (npc && npc.state === "cart") npc.state = "idle";
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
    if (existing.state === "leaving") {
      existing.state = existing.hadCart ? "cart" : "idle";
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
  const line1 = "ZANDMAN'S";
  const line2 = "MAGIC SHOP";
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
  drawPixelText(
    ctx,
    line2,
    sx + Math.round((signW - w2) / 2),
    sy + 3 * scale + 7 * scale + 2,
    scale,
    "#3a1c08"
  );
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
  const scale = 2;
  const text = npc.firstName;
  const tw = text.length * 6 * scale;
  const padX = 7;
  const padY = 5;
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
  drawDoor();
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
}

requestAnimationFrame(frame);
