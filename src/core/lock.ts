import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

/** Coordinates the tray app and CLI using the same local project registry. */
export async function withProjectLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "projects.lock"),
    deadline = Date.now() + 10_000;
  while (true) {
    let file;
    try {
      file = await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // An interrupted process can leave a lock. Never expire a live owner's lock.
      const owner = await readFile(path, "utf8").catch(() => "");
      if (/^[1-9]\d*$/.test(owner)) {
        try {
          process.kill(Number(owner), 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            await unlink(path).catch(() => {});
            continue;
          }
        }
      }
      if (Date.now() > deadline)
        throw new Error(
          "Another Cloak operation is running. Try again when it finishes.",
        );
      await setTimeout(100);
      continue;
    }
    try {
      await file.writeFile(String(process.pid));
      return await operation();
    } finally {
      await file.close();
      await unlink(path);
    }
  }
}
