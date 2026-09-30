import { lstat, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exists } from "./paths.ts";

export type RecoveryRecord = {
  version: number;
  pid: number;
  target: string;
  dev: string;
  ino: string;
  freshDev: string;
  freshIno: string;
  oldDev: string;
  oldIno: string;
};
async function verifyStaging(staging: string, record: RecoveryRecord) {
  const stat = await lstat(staging, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    String(stat.dev) !== record.dev ||
    String(stat.ino) !== record.ino ||
    resolve(await realpath(staging)) !== resolve(staging)
  )
    throw new Error("Recovery staging folder changed. It was not deleted.");
}
export async function verifyRecoveryChild(
  staging: string,
  name: "fresh" | "old",
  record: RecoveryRecord,
) {
  await verifyStaging(staging, record);
  const path = join(staging, name);
  if (!(await exists(path))) return false;
  const stat = await lstat(path, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    String(stat.dev) !== record[`${name}Dev`] ||
    String(stat.ino) !== record[`${name}Ino`] ||
    resolve(await realpath(path)) !== resolve(path)
  )
    throw new Error(`Recovery ${name} folder changed. It was not deleted.`);
  return true;
}
export async function removeRecoveryChild(
  staging: string,
  name: "fresh" | "old",
  record: RecoveryRecord,
) {
  if (await verifyRecoveryChild(staging, name, record))
    await rm(join(staging, name), {
      recursive: true,
      maxRetries: 2,
      retryDelay: 100,
    });
}
export async function removeRecoveryStage(
  staging: string,
  record: RecoveryRecord,
) {
  await removeRecoveryChild(staging, "fresh", record);
  await removeRecoveryChild(staging, "old", record);
  await verifyStaging(staging, record);
  if ((await readdir(staging)).some((name) => name !== "recovery.json"))
    throw new Error("Recovery contains unexpected files. It was not deleted.");
  // Keep the retry record until every potentially large child is gone.
  await rm(join(staging, "recovery.json"), { force: true });
  await rmdir(staging);
}
