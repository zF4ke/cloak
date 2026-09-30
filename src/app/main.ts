import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Service } from "../core/service.ts";
import type { CloakApi } from "../shared/types.ts";

let window: BrowserWindow | undefined,
  tray: Tray | undefined,
  quitting = false,
  service: Service;
const isolated = process.env.CLOAK_DATA_DIR;
app.setName("Cloak");
if (isolated) app.setPath("userData", isolated);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const scripts = app.isPackaged
        ? join(app.getAppPath(), "scripts")
        : app.getAppPath();
      service = new Service(
        isolated || join(app.getPath("appData"), "..", "Local", "cloak"),
        scripts,
        true,
        undefined,
        {
          openPath: async (path) => {
            const error = await shell.openPath(path);
            if (error) throw new Error(error);
          },
          openUrl: (url) => shell.openExternal(url),
          chooseFolder: async () => {
            const result = await dialog.showOpenDialog(window!, {
              properties: ["openDirectory"],
            });
            return result.canceled ? undefined : result.filePaths[0];
          },
          login: (enabled) => {
            if (!isolated)
              app.setLoginItemSettings({
                openAtLogin: enabled,
                args: app.isPackaged
                  ? ["--background"]
                  : [app.getAppPath(), "--background"],
              });
          },
        },
      );
      await service.initialize();
      window = new BrowserWindow({
        width: 760,
        height: 480,
        minWidth: 620,
        minHeight: 420,
        show: false,
        title: "Cloak",
        backgroundColor: "#090909",
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#090909",
          symbolColor: "#a5a7b0",
          height: 42,
        },
        icon: join(app.getAppPath(), "dist/assets/icon.png"),
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      const file = join(app.getAppPath(), "dist/renderer/index.html");
      const allowed = pathToFileURL(file).href;
      ipcMain.handle(
        "cloak",
        (event, method: keyof CloakApi, args: unknown[]) => {
          if (
            event.sender !== window!.webContents ||
            event.senderFrame !== window!.webContents.mainFrame ||
            event.senderFrame.url !== allowed ||
            typeof method !== "string" ||
            !Array.isArray(args)
          )
            throw new Error("Untrusted Cloak request.");
          return service.call(method, args);
        },
      );
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          window!.hide();
        }
      });
      window.center();
      await window.loadFile(file);
      if (!process.argv.includes("--background")) window.show();
      tray = new Tray(
        nativeImage
          .createFromPath(join(app.getAppPath(), "dist/assets/icon.png"))
          .resize({ width: 20, height: 20 }),
      );
      tray.setToolTip("Cloak");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: "Open Cloak",
            click: () => {
              window!.show();
              window!.focus();
            },
          },
          {
            label: "Quit",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("click", () => {
        window!.show();
        window!.focus();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Could not open Cloak",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on("before-quit", () => {
    quitting = true;
    service?.close();
  });
}
