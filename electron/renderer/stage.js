const MAX_NPCS = 6;
const IDLE_MS = 120000;
const NPC_H = 140;
const DOOR_H = 196;
const WALK_SPEED = 130;

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
let cssW = window.innerWidth;
let cssH = window.innerHeight;

const npcs = new Map();
const waiting = [];
const pendingCart = new Set();
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

function groundY() {
  return cssH - 22;
}

function doorX() {
  return cssW - 150;
}

function slotX(index) {
  const left = 36;
  const right = doorX() - 130;
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
    spawnOrRefresh(id);
    return;
  }
  if (payload.type === "heartbeat") {
    const npc = npcs.get(id);
    if (npc) npc.lastEvent = Date.now();
    else spawnOrRefresh(id);
    return;
  }
  if (payload.type === "cart") {
    let npc = npcs.get(id);
    if (!npc) npc = spawnOrRefresh(id);
    if (!npc || !npcs.has(id)) {
      pendingCart.add(id);
      return;
    }
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
}

function spawnOrRefresh(id) {
  const existing = npcs.get(id);
  if (existing) {
    existing.lastEvent = Date.now();
    if (existing.state === "leaving") {
      existing.state = existing.hadCart ? "cart" : "idle";
    }
    return existing;
  }
  if (npcs.size >= MAX_NPCS) {
    if (!waiting.includes(id)) waiting.push(id);
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
  };
  npcs.set(id, npc);
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
    npc.state === "cart" ||
    (npc.state === "idle" && Math.abs(npc.x - npc.targetX) > 2);

  if (npc.state === "entering") {
    npc.facing = -1;
    npc.x -= WALK_SPEED * dt;
    if (npc.x <= npc.targetX) {
      npc.x = npc.targetX;
      npc.state = npc.hadCart ? "cart" : "idle";
    }
  } else if (npc.state === "idle") {
    if (Math.random() < 0.004) {
      npc.targetX = slotX(npc.slot) + (Math.random() - 0.5) * 48;
      npc.facing = npc.targetX >= npc.x ? 1 : -1;
    }
    const dir = Math.sign(npc.targetX - npc.x);
    if (dir) {
      npc.x += dir * 28 * dt;
      npc.facing = dir;
    }
  } else if (npc.state === "cart") {
    npc.hadCart = true;
    const left = 40;
    const right = doorX() - 140;
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
      npc.state = "leaving";
      npc.targetX = doorX() + 8;
      npc.facing = 1;
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

  if (
    Date.now() - npc.lastEvent > IDLE_MS &&
    npc.state !== "leaving" &&
    npc.state !== "celebrating"
  ) {
    npc.state = "leaving";
    npc.targetX = doorX() + 8;
  }

  npc.bob = moving ? Math.abs(Math.sin(performance.now() / 90)) * 4 : Math.sin(performance.now() / 400) * 1.2;
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
  const y = cssH - 26;
  const brickW = 32;
  const brickH = 13;
  ctx.fillStyle = "rgba(8,6,12,0.45)";
  ctx.fillRect(0, y - 8, cssW, 34);
  for (let row = 0; row < 2; row += 1) {
    const off = (row % 2) * (brickW / 2);
    for (let x = -brickW; x < cssW + brickW; x += brickW) {
      ctx.fillStyle = row === 0 ? "#7a757c" : "#4e4a52";
      ctx.fillRect(Math.round(x + off), y + row * brickH, brickW - 2, brickH - 2);
      ctx.fillStyle = "#9a959c";
      ctx.fillRect(Math.round(x + off), y + row * brickH, brickW - 2, 2);
    }
  }
}

function drawDoor() {
  if (!sprites) return;
  const x = doorX();
  const y = groundY() - DOOR_H;
  if (door.t < 0.45) {
    drawSprite(ctx, sprites.doorClosed, x, y, DOOR_H, false);
  } else {
    drawSprite(ctx, sprites.doorOpen, x - 18, y, DOOR_H, false);
  }
}

function spriteFor(npc) {
  if (npc.state === "celebrating") return sprites.celebrate;
  if (npc.state === "cart" || npc.hadCart) return sprites.cart;
  return sprites.idle;
}

function drawNpc(npc) {
  if (!sprites) return;
  const spr = spriteFor(npc);
  const hop = npc.state === "celebrating" ? Math.abs(Math.sin(npc.celebT * 8)) * 14 : 0;
  const h = npc.state === "cart" ? NPC_H : NPC_H;
  const widthGuess = (spr.sw / spr.sh) * h;
  const x = npc.x;
  const y = groundY() - h - npc.bob - hop;
  const flip = npc.facing < 0;
  drawSprite(ctx, spr, x, y, h, flip);
  return widthGuess;
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
}

requestAnimationFrame(frame);
