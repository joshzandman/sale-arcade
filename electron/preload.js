const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arcade", {
  onEvent: (cb) => {
    ipcRenderer.on("arcade-event", (_event, data) => cb(data));
  },
  onQueryCount: (cb) => {
    ipcRenderer.on("arcade-query-count", () => cb());
  },
  sendCount: (n) => ipcRenderer.send("arcade-count", n),
});
