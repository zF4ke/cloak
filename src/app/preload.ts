import { contextBridge, ipcRenderer } from "electron";
const methods = [
  "snapshot",
  "inspect",
  "create",
  "sync",
  "checkUpdates",
  "connectRepository",
  "saveSettings",
  "saveProtection",
  "protectionAction",
  "repairLink",
  "forget",
  "openProject",
  "openRepository",
  "chooseFolder",
];
contextBridge.exposeInMainWorld(
  "cloak",
  Object.fromEntries(
    methods.map((method) => [
      method,
      (...args: unknown[]) => ipcRenderer.invoke("cloak", method, args),
    ]),
  ),
);
