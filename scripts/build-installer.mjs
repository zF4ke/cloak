import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Build on Windows x64.");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Use a release version.");
await stat("release/Cloak/Cloak.exe");
const candidates = [
  "C:\\Program Files (x86)\\NSIS\\makensis.exe",
  "makensis.exe",
];
const compiler = candidates.find((path) => {
  try {
    execFileSync(path, ["-VERSION"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});
if (!compiler) throw new Error("Install NSIS 3 with winget install NSIS.NSIS.");
execFileSync(
  compiler,
  [
    `/DVERSION=${version}`,
    `/DSOURCE=${resolve("release/Cloak")}`,
    `/DICON=${resolve("assets/icon.ico")}`,
    `/DOUT=${resolve("release")}`,
    "scripts/Cloak.nsi",
  ],
  { stdio: "inherit" },
);
console.log(`Installer: release/Cloak-Setup-${version}.exe`);
