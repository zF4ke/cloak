import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/** Prefer the current field, then its configured root, then an existing parent. */
export async function folderPickerPath(
  preferred: string | undefined,
  fallback: string,
) {
  const candidates = [preferred, fallback]
    .filter((path): path is string => Boolean(path && isAbsolute(path)))
    .map((path) => resolve(path));
  const directory = (path: string) =>
    stat(path).then(
      (entry) => entry.isDirectory(),
      () => false,
    );
  for (const path of candidates) if (await directory(path)) return path;
  for (let path of candidates) {
    while (dirname(path) !== path) {
      path = dirname(path);
      if (await directory(path)) return path;
    }
  }
  return undefined;
}
