const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocket } = require("ws");
const { startOrderPoll } = require("./orders");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(app.getPath("userData"), "arcade-state.json");

let overlay;
let tray;
let socket;
let reconnectTimer;
let muted = false;
let visitorCount = 0;
let lastSale = "None yet";
let connected = false;

function loadEnv() {
  const out = {};
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
}

function unionBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const display of displays) {
    const b = display.bounds;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function createOverlay() {
  const bounds = unionBounds();
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    type: "panel",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, "renderer", "stage.html"));
  return win;
}

function sendEvent(payload) {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-event", { muted, ...payload });
  if (payload.type === "enter" || payload.type === "heartbeat") {
    // renderer owns occupancy; ask for a count after a tick
    setTimeout(requestCount, 50);
  }
  if (payload.type === "purchase") {
    const amount = payload.total ? `$${payload.total}` : "Sale";
    const product = payload.productTitle || "order";
    lastSale = `${amount} — ${product}`;
    rebuildMenu();
  }
}

function requestCount() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-query-count");
}

function makeTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <rect x="3" y="1" width="10" height="14" rx="1" fill="black"/>
    <rect x="5" y="3" width="6" height="4" fill="white"/>
    <rect x="10" y="10" width="2" height="2" fill="white"/>
  </svg>`;
  const img = nativeImage.createFromBuffer(Buffer.from(svg));
  if (!img.isEmpty()) img.setTemplateImage(true);
  if (img.isEmpty()) {
    const fallback = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBhOBQBVAgQJ1xN4aQAAAABJRU5ErkJggg=="
    );
    fallback.setTemplateImage(true);
    return fallback;
  }
  return img;
}

function rebuildMenu() {
  if (!tray) return;
  const status = connected ? "Live" : "Offline (menu tests still work)";
  const template = [
    { label: `Sale Arcade — ${status}`, enabled: false },
    { label: `On stage: ${visitorCount}`, enabled: false },
    { label: `Last sale: ${lastSale}`, enabled: false },
    { type: "separator" },
    {
      label: "Test: visitor walks in",
      click: () =>
        sendEvent({
          sessionId: `test-${Date.now()}`,
          type: "enter",
        }),
    },
    {
      label: "Test: add to cart",
      click: () => {
        sendEvent({ sessionId: "test-cart", type: "enter" });
        setTimeout(() => {
          sendEvent({
            sessionId: "test-cart",
            type: "cart",
            productTitle: "Test Tee",
          });
        }, 1400);
      },
    },
    {
      label: "Test: fireworks / purchase",
      click: () => {
        sendEvent({
          sessionId: "test-sale",
          type: "enter",
        });
        setTimeout(() => {
          sendEvent({
            sessionId: "test-sale",
            type: "purchase",
            productTitle: "Test Tee",
            total: "42.00",
          });
        }, 800);
      },
    },
    { type: "separator" },
    {
      label: muted ? "Unmute" : "Mute",
      click: () => {
        muted = !muted;
        sendEvent({ type: "mute", muted });
        rebuildMenu();
      },
    },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`Sale Arcade — ${visitorCount} on stage`);
}

function connectWorker(env) {
  const url = env.WORKER_URL;
  const secret = env.SHARED_SECRET;
  if (!url || !secret || secret === "change-me-to-a-long-random-string") {
    connected = false;
    rebuildMenu();
    return;
  }
  const wsUrl = url.includes("?")
    ? `${url}&secret=${encodeURIComponent(secret)}`
    : `${url}?secret=${encodeURIComponent(secret)}`;

  try {
    socket = new WebSocket(wsUrl);
  } catch (err) {
    console.error("ws construct failed", err);
    scheduleReconnect(env);
    return;
  }

  socket.on("open", () => {
    connected = true;
    rebuildMenu();
  });
  socket.on("message", (data) => {
    try {
      const payload = JSON.parse(String(data));
      if (payload && payload.type) sendEvent(payload);
    } catch (err) {
      console.error("bad event", err);
    }
  });
  socket.on("close", () => {
    connected = false;
    rebuildMenu();
    scheduleReconnect(env);
  });
  socket.on("error", () => {
    socket.close();
  });
}

function scheduleReconnect(env) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectWorker(env), 4000);
}

ipcMain.on("arcade-count", (_event, count) => {
  visitorCount = count;
  rebuildMenu();
});

app.whenReady().then(() => {
  const env = { ...process.env, ...loadEnv() };
  if (process.platform === "darwin") app.dock.hide();

  overlay = createOverlay();
  tray = new Tray(makeTrayIcon());
  rebuildMenu();

  overlay.webContents.on("did-finish-load", () => {
    sendEvent({ type: "mute", muted });
    if (process.argv.includes("--demo")) {
      sendEvent({ sessionId: "demo-1", type: "enter" });
      setTimeout(() => {
        sendEvent({
          sessionId: "demo-1",
          type: "cart",
          productTitle: "Arcade Tee",
        });
      }, 1800);
      setTimeout(() => {
        sendEvent({
          sessionId: "demo-1",
          type: "purchase",
          productTitle: "Arcade Tee",
          total: "42.00",
        });
      }, 4200);
      const snap = async (name) => {
        try {
          const img = await overlay.webContents.capturePage();
          const dest = path.join(ROOT, `demo-${name}.png`);
          fs.writeFileSync(dest, img.toPNG());
          console.log("wrote", dest, img.getSize());
        } catch (err) {
          console.error("capture failed", err);
        }
      };
      setTimeout(() => snap("enter"), 1200);
      setTimeout(() => snap("cart"), 2800);
      setTimeout(() => snap("sale"), 5000);
    }
  });

  connectWorker(env);
  startOrderPoll(env, {
    getLastId: () => loadState().lastOrderId,
    setLastId: (id) => saveState({ lastOrderId: id }),
    onSale: (order) => {
      sendEvent({
        sessionId: `order-${order.id}`,
        type: "purchase",
        productTitle: order.productTitle,
        total: order.total,
        source: "orders-api",
      });
    },
  });

  screen.on("display-added", relayout);
  screen.on("display-removed", relayout);
  screen.on("display-metrics-changed", relayout);
});

function relayout() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setBounds(unionBounds());
}

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("before-quit", () => {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }
});
