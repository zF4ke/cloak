import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

type Owner = { pid: number; token: string };

/** Publish initialized lock directories atomically. Stale recovery cannot
 * rename a new owner's lock over an existing nonempty recovery directory. */
export async function withProjectLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const owner: Owner = { pid: process.pid, token: randomUUID() };
  const pending = join(directory, `projects.pending-${owner.token}`),
    lock = join(directory, "projects.lock");
  await mkdir(pending);
  await writeFile(join(pending, "owner.json"), JSON.stringify(owner));
  const deadline = Date.now() + 10_000;
  try {
    while (true) {
      try {
        await rename(pending, lock);
        break;
      } catch (error) {
        if (
          !["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        let previous: Owner | undefined;
        try {
          previous = JSON.parse(
            await readFile(join(lock, "owner.json"), "utf8"),
          ) as Owner;
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code === "ENOENT" &&
            Date.now() <= deadline
          ) {
            await setTimeout(100);
            continue;
          }
          throw new Error(
            "Cloak's operation lock is unreadable. Quit Cloak and repair projects.lock.",
          );
        }
        if (
          !Number.isInteger(previous.pid) ||
          previous.pid < 1 ||
          !/^[a-f0-9-]{36}$/.test(previous.token)
        )
          throw new Error(
            "Cloak's operation lock is invalid. Quit Cloak and repair projects.lock.",
          );
        let abandoned = false;
        try {
          process.kill(previous.pid, 0);
        } catch (error) {
          abandoned = (error as NodeJS.ErrnoException).code === "ESRCH";
        }
        if (abandoned) {
          const recovered = join(
            directory,
            `projects.recovered-${previous.token}`,
          );
          try {
            await rename(lock, recovered);
          } catch (error) {
            if (
              !["ENOENT", "EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw error;
          }
          // Keep this tiny nonempty tombstone. A second stale reader must not
          // rename a replacement live lock into the same recovery destination.
        }
        if (Date.now() > deadline)
          throw new Error(
            "Another Cloak operation is running. Try again when it finishes.",
          );
        await setTimeout(100);
      }
    }
    try {
      return await operation();
    } finally {
      // Release the public name before deleting private files. A crash during
      // cleanup cannot leave an empty public lock directory.
      const releaseDeadline = Date.now() + 10_000;
      while (true) {
        try {
          await rename(lock, pending);
          break;
        } catch (error) {
          if (
            !["EPERM", "EACCES", "EBUSY"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            ) ||
            Date.now() > releaseDeadline
          )
            throw error;
          // Another Windows reader can briefly hold owner.json open.
          await setTimeout(20);
        }
      }
    }
  } finally {
    await rm(pending, { recursive: true, force: true });
  }
}
