import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { install } from "./install.ts";
import { run } from "../core/commands.ts";

export async function openSetup() {
  app.setName("Cloak Setup");
  if (
    process.env.CLOAK_SETUP_DEBUG_PORT &&
    /^\d+$/.test(process.env.CLOAK_SETUP_DEBUG_PORT)
  ) {
    app.commandLine.appendSwitch(
      "remote-debugging-port",
      process.env.CLOAK_SETUP_DEBUG_PORT,
    );
    app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  }
  app.setPath(
    "userData",
    process.env.CLOAK_SETUP_PROFILE ||
      join(app.getPath("temp"), `cloak-setup-${process.pid}`),
  );
  await app.whenReady();
  const root = app.getAppPath(),
    source = dirname(process.execPath),
    data =
      process.env.CLOAK_SETUP_DATA_DIR ||
      join(app.getPath("appData"), "..", "Local", "cloak");
  const view = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    show: false,
    center: true,
    autoHideMenuBar: true,
    title: "Cloak Setup",
    backgroundColor: "#090909",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#090909", symbolColor: "#a1a1aa", height: 42 },
    icon: join(root, "dist/assets/icon.png"),
    webPreferences: {
      preload: join(__dirname, "setup-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const file = join(root, "dist/setup/index.html"),
    allowed = pathToFileURL(file).href;
  let busy = false,
    target: string | undefined;
  view.on("close", (event) => {
    if (busy) event.preventDefault();
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  ipcMain.handle("setup", async (event, action: string) => {
    if (
      event.sender !== view.webContents ||
      event.senderFrame !== view.webContents.mainFrame ||
      event.senderFrame.url !== allowed
    )
      throw new Error("Untrusted setup request.");
    if (action === "info")
      return { version: app.getVersion(), path: join(data, "app") };
    if (action === "close" && !busy) {
      app.quit();
      return;
    }
    if (action === "open" && target) {
      spawn(join(target, "Cloak.exe"), [], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      app.quit();
      return;
    }
    if (action !== "install" || busy || target)
      throw new Error("Setup is already running.");
    busy = true;
    try {
      target = await install(
        source,
        data,
        (percent) => view.webContents.send("setup:progress", percent),
        {
          running: async (target) => {
            const output = await run("powershell.exe", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Get-Process Cloak -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path | ConvertTo-Json -Compress",
            ]);
            const paths: string | string[] = output ? JSON.parse(output) : [];
            return (Array.isArray(paths) ? paths : [paths]).some(
              (path) =>
                path?.toLowerCase() === join(target, "Cloak.exe").toLowerCase(),
            );
          },
          register: async (target) => {
            if (process.env.CLOAK_SETUP_DATA_DIR) return;
            const start = join(
                app.getPath("appData"),
                "Microsoft/Windows/Start Menu/Programs/Cloak",
              ),
              exe = join(target, "Cloak.exe");
            await mkdir(start, { recursive: true });
            if (
              !shell.writeShortcutLink(join(start, "Cloak.lnk"), {
                target: exe,
                cwd: target,
                icon: join(target, "resources/app/dist/assets/icon.ico"),
              })
            )
              throw new Error("Could not create the Start menu shortcut.");
            if (
              !shell.writeShortcutLink(join(start, "Uninstall Cloak.lnk"), {
                target: join(target, "Uninstall.exe"),
              })
            )
              throw new Error("Could not create the uninstall shortcut.");
            const key =
              "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cloak";
            for (const [name, value] of Object.entries({
              DisplayName: "Cloak",
              DisplayVersion: app.getVersion(),
              Publisher: "zF4ke",
              InstallLocation: target,
              DisplayIcon: exe,
              UninstallString: `"${join(target, "Uninstall.exe")}"`,
            }))
              await run("reg.exe", [
                "ADD",
                key,
                "/v",
                name,
                "/t",
                "REG_SZ",
                "/d",
                value,
                "/f",
              ]);
            await run("powershell.exe", [
              "-NoProfile",
              "-File",
              join(target, "resources/app/scripts/register-cli.ps1"),
              "-Target",
              target,
            ]);
          },
        },
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      busy = false;
    }
  });
  await view.loadFile(file);
  view.show();
  app.on("window-all-closed", () => app.quit());
}
