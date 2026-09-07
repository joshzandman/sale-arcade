const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  ipcMain,
  globalShortcut,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { WebSocket } = require("ws");
const { startOrderPoll } = require("./orders");
const hidKeys = require("./hid-keys");

const ROOT = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..");
const STATE_PATH = path.join(app.getPath("userData"), "arcade-state.json");

let overlay;
let tray;
let socket;
let reconnectTimer;
let muted = false;
let visitorCount = 0;
let lastSale = "None yet";
let connected = false;
let landmark = "door";
let storeName = "Zandman's Magic Shop";
let promptWin = null;
let tipsHeld = false;
let tipsPinned = false;
let tipsWatch = null;

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

const STORE_HOST = "joshzandman.com";

async function lookupProductImage(title) {
  if (!title) return "";
  try {
    const url = `https://${STORE_HOST}/search/suggest.json?q=${encodeURIComponent(
      title
    )}&resources[type]=product&resources[limit]=1`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    const products =
      (data.resources &&
        data.resources.results &&
        data.resources.results.products) ||
      [];
    const product = products[0];
    if (!product) return "";
    return product.image || product.featured_image || "";
  } catch (err) {
    console.error("product lookup failed", err);
    return "";
  }
}

async function fetchImageDataUrl(url) {
  if (!url) return "";
  try {
    const res = await fetch(url);
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err) {
    console.error("image fetch failed", err);
    return "";
  }
}

async function enrichCart(payload) {
  let imageUrl = payload.imageUrl || "";
  if (!imageUrl && payload.productTitle) {
    imageUrl = await lookupProductImage(payload.productTitle);
  }
  if (imageUrl && imageUrl.indexOf("data:") !== 0) {
    payload.imageDataUrl = await fetchImageDataUrl(imageUrl);
    payload.imageUrl = imageUrl;
  }
  return payload;
}

function deliverEvent(payload) {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-event", { muted, ...payload });
  if (payload.type === "enter" || payload.type === "heartbeat") {
    setTimeout(requestCount, 50);
  }
  if (payload.type === "purchase") {
    const amount = payload.total ? `$${payload.total}` : "Sale";
    const product = payload.productTitle || "order";
    lastSale = `${amount} — ${product}`;
    rebuildMenu();
  }
}

function sendEvent(payload) {
  if (!overlay || overlay.isDestroyed()) return;
  if (
    payload.type === "cart" &&
    (payload.imageUrl || payload.productTitle) &&
    !payload.imageDataUrl
  ) {
    enrichCart(payload)
      .then(deliverEvent)
      .catch((err) => {
        console.error("enrich cart failed", err);
        deliverEvent(payload);
      });
    return;
  }
  if (
    (payload.type === "cart_sync" || payload.type === "enter") &&
    Array.isArray(payload.items)
  ) {
    Promise.all(payload.items.map((item) => enrichCart({ ...item })))
      .then((items) => deliverEvent({ ...payload, items }))
      .catch((err) => {
        console.error("enrich cart sync failed", err);
        deliverEvent(payload);
      });
    return;
  }
  deliverEvent(payload);
}

function requestCount() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-query-count");
}

function sendSettings() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-settings", { landmark, storeName });
}

function setLandmark(value) {
  const allowed = ["none", "door", "street", "elevator"];
  landmark = allowed.indexOf(value) >= 0 ? value : "door";
  saveState({ landmark });
  sendSettings();
  rebuildMenu();
}

function setStoreName(value) {
  const next = String(value || "").trim().slice(0, 40);
  if (!next) return;
  storeName = next;
  saveState({ storeName });
  sendSettings();
  rebuildMenu();
}

function askStoreName() {
  if (promptWin && !promptWin.isDestroyed()) {
    promptWin.focus();
    return;
  }
  promptWin = new BrowserWindow({
    width: 440,
    height: 180,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    title: "Store name",
    webPreferences: {
      preload: path.join(__dirname, "prompt-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  promptWin.setAlwaysOnTop(true, "screen-saver", 1);
  promptWin.loadFile(path.join(__dirname, "prompt.html"));
  promptWin.once("ready-to-show", () => {
    promptWin.show();
    promptWin.focus();
  });
  promptWin.webContents.on("did-finish-load", () => {
    promptWin.webContents.send("prompt-init", storeName);
  });
  const onResult = (_event, value) => {
    ipcMain.removeListener("prompt-result", onResult);
    if (value) setStoreName(value);
    if (promptWin && !promptWin.isDestroyed()) promptWin.close();
  };
  ipcMain.on("prompt-result", onResult);
  promptWin.on("closed", () => {
    ipcMain.removeListener("prompt-result", onResult);
    promptWin = null;
  });
}

function makeTrayIcon() {
  const retina = path.join(__dirname, "tray-icon@2x.png");
  const img = nativeImage.createFromPath(
    fs.existsSync(retina) ? retina : path.join(__dirname, "tray-icon.png")
  );
  img.setTemplateImage(true);
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
      label: "Landmark",
      submenu: [
        {
          label: "None",
          type: "radio",
          checked: landmark === "none",
          click: () => setLandmark("none"),
        },
        {
          label: "Door",
          type: "radio",
          checked: landmark === "door",
          click: () => setLandmark("door"),
        },
        {
          label: "Street sign",
          type: "radio",
          checked: landmark === "street",
          click: () => setLandmark("street"),
        },
        {
          label: "Elevator",
          type: "radio",
          checked: landmark === "elevator",
          click: () => setLandmark("elevator"),
        },
      ],
    },
    {
      label: "Set store name…",
      click: () => askStoreName(),
    },
    {
      label: "Clear stage",
      click: () => sendEvent({ type: "clear" }),
    },
    {
      label: tipsPinned
        ? "Hide all visitor info"
        : "Show all visitor info (hold ⌥` or ⌃⇧A)",
      click: () => togglePinnedTips(),
    },
    { type: "separator" },
    {
      label: "Test",
      submenu: [
        {
          label: "Visitor walks in",
          click: () =>
            sendEvent({
              sessionId: `test-${Date.now()}`,
              type: "enter",
            }),
        },
        {
          label: "Member walks in",
          click: () =>
            sendEvent({
              sessionId: "test-member",
              type: "enter",
              firstName: "Josh",
              lastName: "Zandman",
              productTitle: "1984",
              pageUrl: "https://joshzandman.com/products/1984",
              pageTitle: "1984",
              city: "Nashville",
              regionCode: "TN",
              country: "US",
            }),
        },
        {
          label: "Add to cart",
          click: () => {
            sendEvent({
              sessionId: "test-cart",
              type: "enter",
              collectionTitle: "Best Sellers",
              pageUrl: "https://joshzandman.com/collections/best-sellers",
              pageTitle: "Best Sellers",
            });
            setTimeout(() => {
              sendEvent({
                sessionId: "test-cart",
                type: "cart",
                productTitle: "1984",
                productType: "Book",
                pageUrl: "https://joshzandman.com/collections/best-sellers",
                collectionTitle: "Best Sellers",
                imageUrl:
                  "https://cdn.shopify.com/s/files/1/0017/7514/0975/files/1984Cover.jpg?v=1692154466",
              });
            }, 1400);
            setTimeout(() => {
              sendEvent({
                sessionId: "test-cart",
                type: "cart",
                productTitle: "The Hobbit",
                productType: "Book",
                pageUrl: "https://joshzandman.com/collections/best-sellers",
                collectionTitle: "Best Sellers",
              });
            }, 2200);
          },
        },
        {
          label: "Remove from cart",
          click: () =>
            sendEvent({
              sessionId: "test-cart",
              type: "cart_remove",
              productTitle: "1984",
              pageUrl: "https://joshzandman.com/collections/best-sellers",
              collectionTitle: "Best Sellers",
            }),
        },
        {
          label: "Fireworks / purchase",
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
      ],
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
    console.log("arcade connected", url);
    rebuildMenu();
  });
  socket.on("message", (data) => {
    try {
      const payload = JSON.parse(String(data));
      console.log("arcade event", payload && payload.type, payload && payload.sessionId);
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

function sendTips(show) {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-tips", { all: Boolean(show) });
}

function tipsVisible() {
  return tipsHeld || tipsPinned;
}

function togglePinnedTips() {
  tipsPinned = !tipsPinned;
  sendTips(tipsVisible());
  rebuildMenu();
}

function syncHeldTips() {
  const held = hidKeys.tipsComboHeld();
  if (held === tipsHeld) return;
  tipsHeld = held;
  sendTips(tipsVisible());
}

function startTipsWatcher() {
  if (tipsWatch) return;
  hidKeys.tipsComboHeld();
  tipsWatch = setInterval(syncHeldTips, 50);
}

function registerTipsShortcut() {
  globalShortcut.unregisterAll();
  const accelerators = ["Control+Shift+A", "Alt+`", "Option+`"];
  for (const accel of accelerators) {
    try {
      const ok = globalShortcut.register(accel, () => {
        if (hidKeys.tipsComboHeld()) return;
        tipsPinned = !tipsPinned;
        sendTips(tipsVisible());
        rebuildMenu();
      });
      if (!ok) console.error("failed to register", accel);
    } catch (err) {
      console.error("shortcut error", accel, err);
    }
  }
}

app.whenReady().then(() => {
  const env = { ...process.env, ...loadEnv() };
  const saved = loadState();
  if (["none", "door", "street", "elevator"].indexOf(saved.landmark) >= 0) {
    landmark = saved.landmark;
  }
  if (saved.storeName) storeName = String(saved.storeName).slice(0, 40);
  app.setName("Sale Arcade");
  if (process.platform === "darwin") app.dock.hide();

  overlay = createOverlay();
  registerTipsShortcut();
  startTipsWatcher();
  tray = new Tray(makeTrayIcon());
  tray.setTitle("");
  tray.setToolTip("Sale Arcade");
  tray.setIgnoreDoubleClickEvents(true);
  rebuildMenu();

  overlay.webContents.on("did-finish-load", () => {
    sendLayout();
    sendSettings();
    sendTips(tipsVisible());
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

function layoutPayload() {
  const overlayBounds = overlay.getBounds();
  const work = screen.getPrimaryDisplay().workArea;
  return {
    overlay: overlayBounds,
    work: {
      x: work.x - overlayBounds.x,
      y: work.y - overlayBounds.y,
      width: work.width,
      height: work.height,
    },
  };
}

function sendLayout() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send("arcade-layout", layoutPayload());
}

function relayout() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setBounds(unionBounds());
  sendLayout();
}

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

app.on("before-quit", () => {
  if (tipsWatch) {
    clearInterval(tipsWatch);
    tipsWatch = null;
  }
  globalShortcut.unregisterAll();
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.removeAllListeners();
    socket.close();
  }
});
