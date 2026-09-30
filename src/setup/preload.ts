import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("setup", {
  info: () => ipcRenderer.invoke("setup", "info"),
  install: () => ipcRenderer.invoke("setup", "install"),
  open: () => ipcRenderer.invoke("setup", "open"),
  close: () => ipcRenderer.invoke("setup", "close"),
  progress: (callback: (value: number) => void) => {
    ipcRenderer.on("setup:progress", (_event, value: number) =>
      callback(value),
    );
  },
});
