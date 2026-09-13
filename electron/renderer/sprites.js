function isMagentaKey(r, g, b, a) {
  if (a < 8) return true;
  return r > 170 && b > 90 && g < 190 && r - g > 35 && (r + b) / 2 - g > 30;
}

async function loadKeyedSprite(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    if (isMagentaKey(r, g, b, a)) {
      px[i + 3] = 0;
      continue;
    }
    const x = (i / 4) % canvas.width;
    const y = Math.floor(i / 4 / canvas.width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  ctx.putImageData(data, 0, 0);
  if (maxX < minX) {
    return { canvas, sx: 0, sy: 0, sw: canvas.width, sh: canvas.height };
  }
  minX = Math.max(0, minX - 2);
  minY = Math.max(0, minY - 2);
  maxX = Math.min(canvas.width - 1, maxX + 2);
  maxY = Math.min(canvas.height - 1, maxY + 2);
  return {
    canvas,
    sx: minX,
    sy: minY,
    sw: maxX - minX + 1,
    sh: maxY - minY + 1,
  };
}

function drawSprite(ctx, spr, x, y, height, flip) {
  const scale = height / spr.sh;
  const width = spr.sw * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.translate(Math.round(x + width), Math.round(y));
    ctx.scale(-1, 1);
    ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, 0, 0, width, height);
  } else {
    ctx.drawImage(
      spr.canvas,
      spr.sx,
      spr.sy,
      spr.sw,
      spr.sh,
      Math.round(x),
      Math.round(y),
      width,
      height
    );
  }
  ctx.restore();
  return width;
}

async function loadAllSprites() {
  const files = {
    idle: "sprites/npc-idle.jpg",
    cart: "sprites/npc-cart.jpg",
    celebrate: "sprites/npc-celebrate.jpg",
    doorClosed: "sprites/door-closed.jpg",
    doorOpen: "sprites/door-open.jpg",
    look: "sprites/npc-look.jpg",
    attendant: "sprites/elevator-attendant.jpg",
  };
  for (let i = 0; i < 6; i += 1) {
    files[`idle-${i}`] = `sprites/npc-idle-${i}.jpg`;
    files[`look-${i}`] = `sprites/npc-look-${i}.jpg`;
    files[`cart-${i}`] = `sprites/npc-cart-${i}.jpg`;
    files[`celebrate-${i}`] = `sprites/npc-celebrate-${i}.jpg`;
  }
  const out = {};
  await Promise.all(
    Object.entries(files).map(async ([key, url]) => {
      try {
        out[key] = await loadKeyedSprite(url);
        console.log("sprite", key, out[key].sw, "x", out[key].sh);
      } catch (err) {
        console.error("sprite load failed", key, url, err);
      }
    })
  );
  return out;
}
