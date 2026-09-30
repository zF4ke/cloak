import { join } from "node:path";
import { run, type Run } from "./commands.ts";

export async function installedAppRunning(target: string, execute: Run = run) {
  const output = await execute("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Process Cloak -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path | ConvertTo-Json -Compress",
  ]);
  const paths: string | string[] = output ? JSON.parse(output) : [];
  return (Array.isArray(paths) ? paths : [paths]).some(
    (path) => path?.toLowerCase() === join(target, "Cloak.exe").toLowerCase(),
  );
}

export async function registerDesktop(
  target: string,
  version: string,
  execute: Run = run,
) {
  await execute("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(target, "resources/app/scripts/register-installation.ps1"),
    "-Target",
    target,
    "-Version",
    version,
  ]);
}
