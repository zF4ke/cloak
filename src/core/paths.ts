import { lstat, realpath, rename } from "node:fs/promises";
import {
  moveCloudFolder,
  unknownFilesystemError,
  type CloudMove,
} from "./cloud-move.ts";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
export const inside = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
};
export async function resolvedPath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Choose an absolute folder path.");
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await resolvedPath(parent), basename(path));
  }
}
export function projectName(name: string): string {
  const value = name.trim();
  if (
    !value ||
    value.length > 80 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
    value === "." ||
    value === ".."
  )
    throw new Error("Choose a valid project folder name.");
  return value;
}
export const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    },
  );
export async function moveProjectFolder(
  source: string,
  target: string,
  cloud?: CloudMove,
) {
  if (cloud) {
    try {
      cloud = { ...cloud, identity: await lstat(source, { bigint: true }) };
    } catch (error) {
      if (!unknownFilesystemError(error)) throw error;
    }
  }
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      cloud &&
      unknownFilesystemError(error)
    ) {
      await moveCloudFolder(source, target, cloud);
      return;
    }
    if (code === "EBUSY")
      throw new Error(
        "The folder is open in another app. Close editors, terminals and coding-agent sessions, then retry.",
      );
    if (code === "EPERM" || code === "EACCES")
      throw new Error(
        "Windows blocked moving this folder. Close apps using it and check folder permissions, then retry.",
      );
    if (code === "EXDEV")
      throw new Error("Choose a destination on the same drive.");
    if (code === "UNKNOWN" || code?.startsWith("Unknown system error"))
      throw new Error(
        "Windows blocked moving this folder. Use Unlock folder, then retry.",
      );
    throw error;
  }
}
