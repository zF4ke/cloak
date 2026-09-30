import { lstat, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { Run } from "./commands.ts";

export type FolderIdentity = { dev: bigint; ino: bigint };
export type CloudMove = {
  scripts: string;
  directory: string;
  run: Run;
  identity?: FolderIdentity;
};
export const unknownFilesystemError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "UNKNOWN" || Boolean(code?.startsWith("Unknown system error"))
  );
};
const cloudError = (code: number) =>
  [362, 375, 393, 404, -2145452027].includes(code);
const notReady = () =>
  new Error("OneDrive is not ready. Finish signing in or syncing, then retry.");

/** Resume a known OneDrive source before probing its cloud metadata. */
export async function moveCloudFolder(
  source: string,
  target: string,
  options: CloudMove,
) {
  const helper = async (request: object) =>
    JSON.parse(
      await options.run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(options.scripts, "folder-move.ps1"),
          "-Payload",
          Buffer.from(JSON.stringify(request)).toString("base64"),
        ],
        { timeout: 20_000 },
      ),
    ) as { code: number; message: string };
  const parent = await lstat(dirname(target), { bigint: true });
  if (
    parent.isSymbolicLink() ||
    resolve(await realpath(dirname(target))) !== resolve(dirname(target))
  )
    throw new Error("The destination folder changed. Inspect it again.");
  const lease = join(options.directory, `cloud-access-${randomUUID()}.json`);
  await writeFile(
    lease,
    JSON.stringify({ pid: process.pid, expires: Date.now() + 180_000 }),
    { flag: "wx" },
  );
  try {
    await helper({ action: "resume" });
    const deadline = Date.now() + 60_000;
    let identity: FolderIdentity | undefined = options.identity;
    while (true) {
      try {
        const current = await lstat(source, { bigint: true });
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          (identity &&
            (identity.dev !== current.dev || identity.ino !== current.ino)) ||
          resolve(await realpath(source)) !== resolve(source)
        )
          throw new Error("The folder changed. Inspect it again.");
        identity ??= current;
      } catch (error) {
        if (!unknownFilesystemError(error)) throw error;
        if (Date.now() >= deadline) throw notReady();
        await setTimeout(1_000);
        continue;
      }
      const result = await helper({
        action: "move",
        source,
        target,
        dev: String(identity.dev),
        ino: String(identity.ino),
        parentDev: String(parent.dev),
        parentIno: String(parent.ino),
      });
      if (!Number.isInteger(result.code))
        throw new Error("Windows returned an unreadable move result.");
      if (result.code === 0) return;
      if ([5, 32, 33, 391, 395, 397].includes(result.code))
        throw new Error(
          "Windows blocked moving this folder. Use Unlock folder, then retry.",
        );
      if (!cloudError(result.code))
        throw new Error(
          `Windows could not move this folder. ${result.message} [${result.code}]`,
        );
      if (Date.now() >= deadline) throw notReady();
      await setTimeout(1_000);
    }
  } finally {
    // Expiry still releases protection if Windows blocks deleting this tiny
    // lease. Never report a successful move as failed because of lease cleanup.
    await rm(lease, { force: true }).catch(() => {});
  }
}
