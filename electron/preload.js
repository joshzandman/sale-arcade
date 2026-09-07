const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arcade", {
  onEvent: (cb) => {
    ipcRenderer.on("arcade-event", (_event, data) => cb(data));
  },
  onQueryCount: (cb) => {
    ipcRenderer.on("arcade-query-count", () => cb());
  },
  sendCount: (n) => ipcRenderer.send("arcade-count", n),
  onLayout: (cb) => {
    ipcRenderer.on("arcade-layout", (_event, data) => cb(data));
  },
  onSettings: (cb) => {
    ipcRenderer.on("arcade-settings", (_event, data) => cb(data));
  },
});
