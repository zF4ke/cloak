import {
  cp,
  mkdir,
  rename,
  writeFile,
  copyFile,
  readFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { rcedit } from "rcedit";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const target = "release/Cloak";
await mkdir(target, { recursive: true });
await cp("node_modules/electron/dist", target, { recursive: true });
await rename(join(target, "electron.exe"), join(target, "Cloak.exe"));
await rcedit(join(target, "Cloak.exe"), {
  icon: resolve("assets/icon.ico"),
  "file-version": version,
  "product-version": version,
  "version-string": {
    ProductName: "Cloak",
    FileDescription: "Cloak",
    CompanyName: "zF4ke",
    OriginalFilename: "Cloak.exe",
  },
});
const app = join(target, "resources/app");
await mkdir(join(app, "scripts"), { recursive: true });
for (const folder of ["app", "renderer", "assets", "setup"])
  await cp(join("dist", folder), join(app, "dist", folder), {
    recursive: true,
  });
await copyFile("dist/cli.cjs", join(app, "dist/cli.cjs"));
for (const script of [
  "cloak.ps1",
  "cloakd.ps1",
  "install.ps1",
  "probe.ps1",
  "desktop-control.ps1",
  "config.jsonc",
  "scripts/register-cli.ps1",
  "scripts/uninstall-desktop.ps1",
])
  await copyFile(script, join(app, "scripts", script.split("/").at(-1)));
await mkdir(join(app, "scripts/dist"), { recursive: true });
await copyFile("dist/cli.cjs", join(app, "scripts/dist/cli.cjs"));
await writeFile(
  join(app, "package.json"),
  JSON.stringify({
    name: "cloak",
    productName: "Cloak",
    version,
    main: "dist/app/main.cjs",
  }),
);
await writeFile(
  join(target, "cloak.cmd"),
  '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nset "CLOAK_SCRIPTS_DIR=%~dp0resources\\app\\scripts"\r\n"%~dp0Cloak.exe" "%~dp0resources\\app\\dist\\cli.cjs" %*\r\n',
);
console.log(`Portable app: ${target}/Cloak.exe`);
