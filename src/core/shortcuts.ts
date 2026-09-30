import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Run } from "./commands.ts";
import { projectName } from "./paths.ts";

export const shortcutPath = (folder: string, name: string) =>
  join(resolve(folder), `${projectName(name)}.lnk`);

async function shellShortcut(scripts: string, run: Run, value: object) {
  if (process.platform !== "win32")
    throw new Error("Project shortcuts require Windows.");
  return run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    join(scripts, "project-shortcut.ps1"),
    "-Encoded",
    Buffer.from(JSON.stringify(value), "utf8").toString("base64"),
  ]);
}

/** Read shell metadata without following a filesystem link or opening the target. */
export async function shortcutMatches(
  path: string,
  target: string,
  scripts: string,
  run: Run,
) {
  if (!path.toLowerCase().endsWith(".lnk")) return false;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const value = JSON.parse(
      await shellShortcut(scripts, run, { action: "read", path }),
    );
    return (
      typeof value.target === "string" &&
      isAbsolute(value.target) &&
      value.arguments === "" &&
      resolve(value.target).toLowerCase() === resolve(target).toLowerCase()
    );
  } catch {
    return false;
  }
}

/** Publish an ordinary file exclusively. Existing entries are never overwritten. */
export async function createShortcut(
  path: string,
  target: string,
  scripts: string,
  run: Run,
) {
  const folder = dirname(path);
  await mkdir(folder, { recursive: true });
  const parent = await realpath(folder);
  const actual = await realpath(target);
  const stat = await lstat(actual);
  if (!stat.isDirectory() || resolve(actual) !== resolve(target))
    throw new Error("Choose the real project folder for the shortcut.");
  const bytes = Buffer.from(
    await shellShortcut(scripts, run, { action: "create", target: actual }),
    "base64",
  );
  if (bytes.length < 76 || bytes.readUInt32LE(0) !== 76)
    throw new Error("Windows could not create the project shortcut.");
  if (resolve(await realpath(folder)) !== resolve(parent))
    throw new Error("The shortcuts folder changed. Try again.");
  await writeFile(path, bytes, { flag: "wx" });
}
