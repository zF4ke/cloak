import * as filesystem from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { inside } from "../core/paths.ts";

// Electron's patched fs treats .asar archives as directories. Setup must copy
// the actual archive bytes, including Electron's own default_app.asar.
const { copyFile, lstat, mkdir, readdir, rename, rm, stat, realpath } = process
  .versions.electron
  ? (require("original-fs") as typeof import("node:fs")).promises
  : filesystem;

async function files(
  root: string,
  directory = root,
): Promise<{ path: string; size: number }[]> {
  const items: { path: string; size: number }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        "Setup contains an unexpected folder link. Download the installer again.",
      );
    if (entry.isDirectory()) items.push(...(await files(root, path)));
    else if (entry.isFile())
      items.push({ path, size: (await stat(path)).size });
  }
  return items;
}

/** Copies application bytes only. Project registry and user folders stay outside app/. */
export async function install(
  source: string,
  directory: string,
  report: (percent: number) => void,
  options: {
    running(target: string): Promise<boolean>;
    register(target: string): Promise<void>;
  },
) {
  const target = join(directory, "app"),
    stage = join(directory, `app.setup-${randomUUID()}`),
    previous = join(directory, `app.previous-${randomUUID()}`);
  for (const path of [target, stage, previous])
    if (!inside(directory, path) || resolve(path) === resolve(directory))
      throw new Error("Invalid installation path.");
  await mkdir(directory, { recursive: true });
  if (
    (await realpath(directory)).toLowerCase() !==
    resolve(directory).toLowerCase()
  )
    throw new Error(
      "The installation folder must not redirect through a folder link.",
    );
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("The installation folder must be a real local folder.");
  if (resolve(source).toLowerCase() === resolve(target).toLowerCase())
    throw new Error("Run the downloaded installer.");
  if (await options.running(target))
    throw new Error(
      "Cloak is running. Choose Quit in its tray menu, then try again.",
    );
  const items = await files(source),
    total = items.reduce((sum, item) => sum + item.size, 0);
  if (!items.some((item) => relative(source, item.path) === "Cloak.exe"))
    throw new Error("Setup is missing Cloak.exe. Download it again.");
  let copied = 0,
    swapped = false,
    movedPrevious = false;
  try {
    for (const item of items) {
      const destination = join(stage, relative(source, item.path));
      if (!inside(stage, destination)) throw new Error("Invalid setup file.");
      await mkdir(join(destination, ".."), { recursive: true });
      await copyFile(item.path, destination);
      copied += item.size;
      report(Math.round((90 * copied) / Math.max(1, total)));
    }
    if (await options.running(target))
      throw new Error(
        "Cloak opened during setup. Quit it from the tray, then try again.",
      );
    // Never replace a folder link with an app update.
    const existing = await lstat(target).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing?.isSymbolicLink())
      throw new Error(
        "The app folder is a link. Move it back to a real local folder before updating.",
      );
    if (existing) {
      await rename(target, previous);
      movedPrevious = true;
    }
    try {
      await rename(stage, target);
      swapped = true;
      await options.register(target);
    } catch (error) {
      if (swapped) {
        await rm(target, { recursive: true, force: true });
        swapped = false;
      }
      if (movedPrevious) {
        await rename(previous, target);
        movedPrevious = false;
      }
      throw error;
    }
    report(100);
    if (movedPrevious)
      await rm(previous, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 250,
      });
    return target;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
