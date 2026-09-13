const MAX_NPCS = SaleArcade.MAX_NPCS;
const NPC_H = SaleArcade.NPC_SIZES.normal;
const DOOR_H = 196;
const ELEVATOR_W = 92;
const ELEVATOR_H = 152;
const WALK_SPEED = 130;
const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
let cssW = window.innerWidth;
let cssH = window.innerHeight;
let stage = { left: 0, top: 0, width: cssW, height: cssH };

const imageCache = new Map();
let world = null;
let npcs = new Map();
let sprites = null;
let rockets = [];
let caption = null;
let door = { phase: "closed", t: 0 };
let doorHold = 0;
let elevator = { phase: "hidden", rise: 0, doors: 0, hold: 0 };
let last = performance.now();
let muted = false;
let showAllTips = true;
let settings = {
  landmark: "door",
  storeName: "Zandman's Magic Shop",
  showStage: true,
  npcSize: "normal",
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
  if (SaleArcade.LANDMARKS.indexOf(data.landmark) >= 0) {
    if (settings.landmark !== data.landmark) {
      elevator = { phase: "hidden", rise: 0, doors: 0, hold: 0 };
      door = { phase: "closed", t: 0 };
      doorHold = 0;
    }
    settings.landmark = data.landmark;
  }
  if (data.storeName) {
    settings.storeName = String(data.storeName).slice(0, 40);
  }
  if (typeof data.showStage === "boolean") {
    settings.showStage = data.showStage;
  }
  if (SaleArcade.NPC_SIZES[data.npcSize]) {
    settings.npcSize = data.npcSize;
  }
  if (world) world.applySettings(settings);
}

function npcHeight() {
  return SaleArcade.npcHeightFor(settings.npcSize);
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
  return stage.top + stage.height - 13;
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
  if (settings.landmark === "none") return 36;
  if (settings.landmark === "street") return streetSignWidth();
  if (settings.landmark === "elevator") return ELEVATOR_W + 8;
  return doorWidth();
}

function elevatorX() {
  return stage.left + stage.width - ELEVATOR_W - 20;
}

function elevatorReady() {
  return elevator.phase === "open" || (elevator.phase === "opening" && elevator.doors > 0.55);
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
  const gap = SaleArcade.minNpcGap(npcHeight());
  const step = Math.max(gap, span / MAX_NPCS);
  const x = left + (index + 0.5) * step;
  return Math.min(right - 8, x);
}

function reportCount() {
  if (window.arcade) window.arcade.sendCount(npcs.size);
}

function wrapPixelText(text, scale, maxWidth, maxLines) {
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return [""];
  const limit = maxLines || 3;
  const lines = [];
  let rest = raw;
  while (rest && lines.length < limit) {
    if (measurePixelText(rest, scale) <= maxWidth) {
      lines.push(rest);
      break;
    }
    let cut = rest.length;
    while (cut > 1 && measurePixelText(rest.slice(0, cut), scale) > maxWidth) {
      cut -= 1;
    }
    let piece = rest.slice(0, cut);
    const space = piece.lastIndexOf(" ");
    if (space >= 6) {
      piece = piece.slice(0, space);
      cut = piece.length;
    }
    lines.push(piece.trim());
    rest = rest.slice(cut).trim();
  }
  return lines.length ? lines : [raw];
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

function openDoor() {
  if (settings.landmark !== "door") return;
  if (door.phase === "closed") {
    door.phase = "opening";
    door.t = 0;
    ArcadeAudio.door();
  }
  doorHold = 0.9;
}

function callElevator() {
  if (settings.landmark !== "elevator") return;
  if (elevator.phase === "hidden") {
    elevator.phase = "rising";
    elevator.rise = 0;
    elevator.doors = 0;
    ArcadeAudio.elevator();
  } else if (elevator.phase === "descending" && elevator.rise < 0.35) {
    elevator.phase = "rising";
    ArcadeAudio.elevator();
  }
  elevator.hold = 0.85;
}

function requestLandmark() {
  if (settings.landmark === "door") openDoor();
  if (settings.landmark === "elevator") callElevator();
}


function bootArcade() {
  world = SaleArcade.createStage({
    now: () => Date.now(),
    getLandmark: () => settings.landmark,
    doorX: () => doorX(),
    elevatorX: () => elevatorX(),
    slotX: (index) => slotX(index),
    elevatorReady: () => elevatorReady(),
    requestLandmark: () => requestLandmark(),
    getBodyWidth: () => SaleArcade.minNpcGap(npcHeight()),
    stageLeft: () => stageLeft(),
    stageRight: () => stageRight(),
    onCount: (n) => {
      if (window.arcade) window.arcade.sendCount(n);
    },
    onCartSound: () => ArcadeAudio.cart(),
    onBoom: () => ArcadeAudio.boom(),
    onMute: (value) => {
      muted = value;
      ArcadeAudio.setMuted(value);
    },
    onPurchaseFx: (npc, payload) => {
      const amount = payload && payload.total ? `$${payload.total}` : "SALE";
      const title = ((payload && payload.productTitle) || "ORDER").slice(0, 18);
      caption = { text: `${amount} - ${title}`, t: 0 };
      const originX = (npc && npc.x) || cssW / 2;
      const originY = groundY() - 220;
      rockets = rockets.concat(spawnFireworks(12, originX, originY));
    },
    loadImage: (url) => loadProductImage(url),
  });
  npcs = world.npcs;
}

function handleEvent(payload) {
  if (!world) bootArcade();
  world.handleEvent(payload);
}

function hoverViewLine(npc) {
  return SaleArcade.hoverViewLine(npc);
}

function locationLabel(npc) {
  return SaleArcade.locationLabel(npc);
}

function hasCart(npc) {
  return SaleArcade.hasCart(npc);
}

function stepElevator(dt) {
  if (settings.landmark !== "elevator") return;
  if (elevator.phase === "rising") {
    elevator.rise = Math.min(1, elevator.rise + dt * 2.1);
    if (elevator.rise >= 1) {
      elevator.phase = "opening";
      elevator.doors = 0;
      ArcadeAudio.ding();
    }
  } else if (elevator.phase === "opening") {
    elevator.doors = Math.min(1, elevator.doors + dt * 2.8);
    if (elevator.doors >= 1) elevator.phase = "open";
  } else if (elevator.phase === "open") {
    for (const n of npcs.values()) {
      if (n.state === "entering" && !n.disembarked) {
        elevator.hold = Math.max(elevator.hold, 0.35);
      }
      if (n.state === "leaving" && n.x > elevatorX() - 24) {
        elevator.hold = Math.max(elevator.hold, 0.35);
      }
    }
    elevator.hold -= dt;
    if (elevator.hold <= 0) elevator.phase = "closing";
  } else if (elevator.phase === "closing") {
    elevator.doors = Math.max(0, elevator.doors - dt * 2.8);
    if (elevator.doors <= 0) elevator.phase = "descending";
  } else if (elevator.phase === "descending") {
    elevator.rise = Math.max(0, elevator.rise - dt * 2.1);
    if (elevator.rise <= 0) {
      elevator.phase = "hidden";
      elevator.doors = 0;
    }
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
  if (!settings.showStage) return;
  const brickW = 32;
  const y = groundY();
  const h = Math.max(1, stage.top + stage.height - y);
  const x0 = stage.left;
  const w = stage.width;
  ctx.fillStyle = "rgba(8,6,12,0.45)";
  ctx.fillRect(x0, y, w, h);
  for (let x = x0 - brickW; x < x0 + w + brickW; x += brickW) {
    ctx.fillStyle = "#4e4a52";
    ctx.fillRect(Math.round(x), y, brickW - 2, h);
    ctx.fillStyle = "#9a959c";
    ctx.fillRect(Math.round(x), y, brickW - 2, 2);
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

function drawElevator() {
  const rise = elevator.rise;
  if (rise <= 0.02 && elevator.phase === "hidden") return;
  const x = elevatorX();
  const cabinH = ELEVATOR_H;
  const y = groundY() - cabinH * rise;
  const w = ELEVATOR_W;
  const doors = elevator.doors;
  ctx.save();
  ctx.beginPath();
  ctx.rect(stage.left, 0, stage.width, groundY() + 1);
  ctx.clip();
  ctx.fillStyle = "#1a1c22";
  ctx.fillRect(x - 4, y - 6, w + 8, cabinH + 6);
  ctx.fillStyle = "#6d717c";
  ctx.fillRect(x, y, w, cabinH);
  ctx.fillStyle = "#9aa0aa";
  ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = "#2b2e36";
  ctx.fillRect(x + 4, y + 14, w - 8, cabinH - 22);
  if (doors > 0.05) {
    ctx.fillStyle = "#c9a24a";
    ctx.fillRect(x + 10, y + 22, w - 20, cabinH - 36);
  }
  if (sprites && sprites.attendant && doors > 0.28) {
    const ah = 112;
    const ax = x + 8;
    const ay = y + cabinH - ah - 8;
    drawSprite(ctx, sprites.attendant, ax, ay, ah, true);
  }
  const gap = Math.round(((w - 8) / 2) * doors);
  const leftDoorW = Math.round((w - 8) / 2) - gap;
  const rightDoorW = Math.round((w - 8) / 2) - gap;
  ctx.fillStyle = "#8b909c";
  if (leftDoorW > 0) ctx.fillRect(x + 4, y + 14, leftDoorW, cabinH - 22);
  if (rightDoorW > 0) {
    ctx.fillRect(x + w - 4 - rightDoorW, y + 14, rightDoorW, cabinH - 22);
  }
  ctx.fillStyle = "#3a3d46";
  ctx.fillRect(x + 4, y + 14, 2, cabinH - 22);
  ctx.fillRect(x + w - 6, y + 14, 2, cabinH - 22);
  ctx.fillStyle = "#111318";
  ctx.fillRect(x + 8, y + 2, w - 16, 6);
  const label = splitSignLines(settings.storeName)[0].slice(0, 10);
  drawPixelText(
    ctx,
    label,
    x + Math.round((w - label.length * 6) / 2),
    y + 2,
    1,
    "#d4e8ff"
  );
  ctx.restore();
  ctx.fillStyle = "rgba(8,6,12,0.55)";
  ctx.fillRect(x - 6, groundY() - 3, w + 12, 4);
}

function drawLandmark() {
  if (settings.landmark === "none") return;
  if (settings.landmark === "street") {
    drawStreetSign();
    return;
  }
  if (settings.landmark === "elevator") {
    drawElevator();
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
  const outfit = Number.isInteger(npc.outfit) ? npc.outfit : 0;
  if (npc.state === "celebrating") {
    return sprites[`celebrate-${outfit}`] || sprites.celebrate;
  }
  if (hasCart(npc) || npc.state === "cart") {
    return sprites[`cart-${outfit}`] || sprites.cart;
  }
  if (npc.state === "idle" && npc.look === "up") {
    return sprites[`look-${outfit}`] || sprites.look;
  }
  return sprites[`idle-${outfit}`] || sprites.idle;
}

function drawCartItems(npc, x, y, width, height, flip) {
  const items = npc.items || [];
  if (!items.length) return;
  const shown = items.slice(-4);
  shown.forEach((item, i) => {
    const kind = `${item.productType || ""} ${item.title || ""}`.toLowerCase();
    const isBook = /book|novel|isbn|paperback|hardcover|fiction/.test(kind);
    const scale = npcHeight() / NPC_H;
    const iw = (isBook ? 22 : 26) * scale;
    const ih = (isBook ? 32 : 26) * scale;
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

function npcVisible(npc) {
  if (settings.landmark !== "elevator") return true;
  if (npc.state === "entering" && !npc.disembarked && elevator.rise < 0.82) {
    return false;
  }
  if (
    npc.state === "leaving" &&
    npc.x >= elevatorX() + 8 &&
    (elevator.doors < 0.35 || elevator.rise < 0.85)
  ) {
    return false;
  }
  return true;
}

function drawNpc(npc) {
  if (!sprites) return;
  if (!npcVisible(npc)) return;
  const spr = spriteFor(npc);
  const hop = npc.state === "celebrating" ? Math.abs(Math.sin(npc.celebT * 8)) * 14 : 0;
  const h = npcHeight();
  const width = (spr.sw / spr.sh) * h;
  const x = npc.x;
  const y = groundY() - h - npc.bob - hop;
  const flip = npc.facing < 0;
  drawSprite(ctx, spr, x, y, h, flip);
  if (hasCart(npc) && npc.state !== "celebrating") {
    drawCartItems(npc, x, y, width, h, flip);
  }
  npc.bounds = { x, y, w: width, h };
  return width;
}

function hoverCardLines(npc) {
  const scale = 1;
  const maxW = 26 * 6 * scale;
  const lines = wrapPixelText(hoverViewLine(npc), scale, maxW, 3).map((text) => ({
    text,
    color: "#fff1a8",
    scale,
    align: "center",
  }));
  const loc = locationLabel(npc);
  if (loc) {
    wrapPixelText(String(loc), scale, maxW, 2).forEach((text) => {
      lines.push({
        text,
        color: "#c8d4e8",
        scale,
        align: "center",
      });
    });
  }
  return lines;
}

function drawHoverCard(npc) {
  const lines = hoverCardLines(npc);
  const padX = 8;
  const padY = 6;
  const gap = 3;
  const widths = lines.map((line) => measurePixelText(line.text, line.scale));
  const tw = Math.max.apply(null, widths.concat([0]));
  const bw = tw + padX * 2;
  let contentH = 0;
  lines.forEach((line, i) => {
    contentH += 7 * line.scale;
    if (i < lines.length - 1) contentH += gap;
  });
  const bh = contentH + padY * 2;
  const b = npc.bounds || { x: npc.x, y: groundY() - npcHeight(), w: 80 };
  let bx = Math.round(b.x + b.w / 2 - bw / 2);
  let by = Math.round((b.y || groundY() - npcHeight()) - bh - 10);
  bx = Math.max(stage.left + 4, Math.min(bx, stage.left + stage.width - bw - 4));
  by = Math.max(stage.top + 4, by);
  ctx.fillStyle = "rgba(12,8,20,0.88)";
  ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  ctx.fillStyle = "#1a1028";
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#6b5a3a";
  ctx.fillRect(bx, by, bw, 2);
  let y = by + padY;
  lines.forEach((line, i) => {
    const textX =
      line.align === "left"
        ? bx + padX
        : bx + Math.round((bw - widths[i]) / 2);
    drawPixelText(ctx, line.text, textX, y, line.scale, line.color);
    y += 7 * line.scale + gap;
  });
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

let loopId = 0;

function startLoop() {
  loopId += 1;
  const id = loopId;
  last = performance.now();
  function frame(now) {
    if (id !== loopId) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stepDoor(dt);
    stepElevator(dt);
    if (world) world.step(dt);
    rockets = stepFireworks(rockets);

    ctx.clearRect(0, 0, cssW, cssH);
    drawSidewalk();
    drawLandmark();
    const ordered = [...npcs.values()].sort((a, b) => a.x - b.x);
    for (const npc of ordered) drawNpc(npc);
    if (showAllTips) {
      for (const npc of ordered) {
        if (npcVisible(npc)) drawHoverCard(npc);
      }
    }
    drawFireworks(ctx, rockets);
    drawCaption();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

loadAllSprites()
  .then((loaded) => {
    sprites = loaded;
  })
  .catch((err) => {
    console.error("sprite load failed", err);
  });

bootArcade();

if (window.arcade) {
  window.arcade.onEvent(handleEvent);
  window.arcade.onQueryCount(reportCount);
  if (window.arcade.onLayout) window.arcade.onLayout(applyLayout);
  if (window.arcade.onSettings) window.arcade.onSettings(applySettings);
  if (window.arcade.onTips) {
    window.arcade.onTips((data) => {
      showAllTips = Boolean(data && data.all);
    });
  }
  if (window.arcade.onWake) {
    window.arcade.onWake(() => {
      resize();
      startLoop();
    });
  }
}

startLoop();
