import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exists, inside } from "./paths.ts";
import {
  removeRecoveryChild,
  removeRecoveryStage,
  verifyRecoveryChild,
  type RecoveryRecord,
} from "./recovery-record.ts";

/** Called under the project operation lock. Never discard an unregistered original. */
export async function cleanupRecoveries(
  folder: string,
  managed: string[],
): Promise<string[]> {
  if (!(await exists(folder))) return [];
  const root = await realpath(folder);
  const warnings: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(".cloak-recovery-") || !entry.isDirectory())
      continue;
    const staging = join(root, entry.name);
    try {
      const stat = await lstat(staging, { bigint: true });
      const journal = JSON.parse(
        await readFile(join(staging, "recovery.json"), "utf8"),
      ) as RecoveryRecord;
      if (
        journal.version !== 1 ||
        !Number.isInteger(journal.pid) ||
        journal.pid < 1 ||
        String(stat.dev) !== journal.dev ||
        String(stat.ino) !== journal.ino ||
        resolve(await realpath(staging)) !== resolve(staging) ||
        resolve(await realpath(root)) !== resolve(root) ||
        !inside(root, journal.target) ||
        resolve(root) === resolve(journal.target)
      )
        throw new Error(
          "Recovery record is invalid. Inspect this folder before removing it.",
        );
      if (journal.pid !== process.pid) {
        try {
          process.kill(journal.pid, 0);
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
        }
      }
      const children = await readdir(staging);
      if (
        children.some(
          (name) => !["fresh", "old", "recovery.json"].includes(name),
        )
      )
        throw new Error(
          "Folder contains unexpected files. Inspect it before removing it.",
        );
      const old = join(staging, "old");
      if (await exists(old)) {
        await verifyRecoveryChild(staging, "old", journal);
        const target = await lstat(journal.target, { bigint: true }).catch(
          () => undefined,
        );
        const registered = managed.some(
          (path) => resolve(path) === resolve(journal.target),
        );
        const replacement =
          target?.isDirectory() &&
          !target.isSymbolicLink() &&
          resolve(await realpath(journal.target)) === resolve(journal.target) &&
          String(target.dev) === journal.freshDev &&
          String(target.ino) === journal.freshIno;
        if (!registered || !replacement) {
          // A crashed swap can leave the only original here. Release the extra clone, retain that original.
          await removeRecoveryChild(staging, "fresh", journal);
          // A crash after installation leaves the disposable clone at target instead.
          if (!registered && replacement)
            await rm(journal.target, {
              recursive: true,
              maxRetries: 2,
              retryDelay: 100,
            });
          warnings.push(
            `Original files need restoration at ${old}. They were not deleted.`,
          );
          continue;
        }
      }
      await removeRecoveryStage(staging, journal);
    } catch (error) {
      warnings.push(
        `Recovery cleanup pending at ${staging}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return warnings;
}
