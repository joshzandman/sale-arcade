const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("promptApi", {
  init: (cb) => ipcRenderer.on("prompt-init", (_event, value) => cb(value)),
  submit: (value) => ipcRenderer.send("prompt-result", value),
  cancel: () => ipcRenderer.send("prompt-result", null),
});
