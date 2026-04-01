const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trackerApp", {
  getStatus: () => ipcRenderer.invoke("tracker:get-status"),
  start: (intervalSeconds) => ipcRenderer.invoke("tracker:start", intervalSeconds),
  stop: () => ipcRenderer.invoke("tracker:stop"),
  openLogDir: () => ipcRenderer.invoke("tracker:open-log-dir"),
  chooseLogDir: () => ipcRenderer.invoke("tracker:choose-log-dir"),
  openSummary: () => ipcRenderer.invoke("tracker:open-summary"),
  openFileSummary: () => ipcRenderer.invoke("tracker:open-file-summary"),
});
