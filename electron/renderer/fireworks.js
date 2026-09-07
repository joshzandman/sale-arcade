const FW_COLORS = [
  "#fffbe6",
  "#ff3b3b",
  "#ffd24a",
  "#3ec8ff",
  "#ff6bdc",
  "#7dff6b",
  "#ffffff",
];

function spawnFireworks(bursts, originX, originY) {
  const rockets = [];
  for (let i = 0; i < bursts; i += 1) {
    rockets.push({
      x: originX + (Math.random() - 0.5) * 420,
      y: originY + Math.random() * 40,
      vx: (Math.random() - 0.5) * 3.2,
      vy: -6.5 - Math.random() * 4.5,
      life: 28 + Math.random() * 22,
      color: FW_COLORS[i % FW_COLORS.length],
      bits: [],
      exploded: false,
    });
  }
  return rockets;
}

function stepFireworks(rockets) {
  for (const rocket of rockets) {
    if (!rocket.exploded) {
      rocket.x += rocket.vx;
      rocket.y += rocket.vy;
      rocket.vy += 0.16;
      rocket.life -= 1;
      if (rocket.life <= 0 || rocket.vy > 0.4) {
        rocket.exploded = true;
        const n = 22 + Math.floor(Math.random() * 12);
        for (let i = 0; i < n; i += 1) {
          const angle = (i / n) * Math.PI * 2 + Math.random() * 0.2;
          const speed = 1.8 + Math.random() * 3.8;
          rocket.bits.push({
            x: rocket.x,
            y: rocket.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 55 + Math.random() * 35,
            color: Math.random() > 0.7 ? "#fffbe6" : rocket.color,
            size: 4 + Math.floor(Math.random() * 4),
          });
        }
      }
    } else {
      for (const bit of rocket.bits) {
        bit.x += bit.vx;
        bit.y += bit.vy;
        bit.vy += 0.08;
        bit.vx *= 0.98;
        bit.life -= 1;
      }
    }
  }
  return rockets.filter((rocket) => {
    if (!rocket.exploded) return true;
    rocket.bits = rocket.bits.filter((bit) => bit.life > 0);
    return rocket.bits.length > 0;
  });
}

function drawFireworks(ctx, rockets) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const rocket of rockets) {
    if (!rocket.exploded) {
      ctx.fillStyle = rocket.color;
      ctx.fillRect(Math.round(rocket.x), Math.round(rocket.y), 4, 8);
    } else {
      for (const bit of rocket.bits) {
        ctx.globalAlpha = Math.max(0.15, bit.life / 40);
        ctx.fillStyle = bit.color;
        const s = bit.size;
        ctx.fillRect(Math.round(bit.x), Math.round(bit.y), s, s);
      }
    }
  }
  ctx.restore();
}
