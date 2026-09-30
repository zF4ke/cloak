import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Run } from "./commands.ts";
import type { CloudMove } from "./cloud-move.ts";
import { gitState } from "./git.ts";
import { exists, inside, moveProjectFolder } from "./paths.ts";
import { removeRecoveryStage, type RecoveryRecord } from "./recovery-record.ts";

type Recovery = {
  source: string;
  target: string;
  root: string;
  remote: string;
  branch?: string;
  cloudMove?: CloudMove;
};

/** Clone first, swap whole folders, register, then delete only the displaced folder. */
export async function replaceFromRemote<T extends { warning?: string }>(
  plan: Recovery,
  run: Run,
  verifySource: () => Promise<void>,
  register: (onLinkCreated: (path: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  await mkdir(plan.root, { recursive: true });
  const root = await realpath(plan.root);
  if (!inside(root, plan.target) || resolve(plan.target) === resolve(root))
    throw new Error(
      "Recovery destination must be inside the real project folder.",
    );
  const sourceStat = await lstat(plan.source, { bigint: true });
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())
    throw new Error("Choose the real project folder for recovery.");
  if (resolve(await realpath(plan.source)) !== resolve(plan.source))
    throw new Error("The source folder changed. Inspect it again.");
  if (
    resolve(plan.source) !== resolve(plan.target) &&
    (inside(plan.source, plan.target) || inside(plan.target, plan.source))
  )
    throw new Error("Recovery folders must not contain each other.");
  if (plan.branch)
    await run("git", ["check-ref-format", "--branch", plan.branch]);
  const staging = await mkdtemp(join(root, ".cloak-recovery-"));
  const stagingIdentity = await lstat(staging, { bigint: true });
  const journal: RecoveryRecord = {
    version: 1,
    pid: process.pid,
    target: plan.target,
    dev: String(stagingIdentity.dev),
    ino: String(stagingIdentity.ino),
    freshDev: "",
    freshIno: "",
    oldDev: String(sourceStat.dev),
    oldIno: String(sourceStat.ino),
  };
  const fresh = join(staging, "fresh"),
    old = join(staging, "old");
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  let freshIdentity: { dev: bigint; ino: bigint };
  let createdLink: { path: string; dev: bigint; ino: bigint } | undefined;
  async function cleanup() {
    if (
      !inside(root, staging) ||
      resolve(await realpath(staging)) !== resolve(staging) ||
      resolve(await realpath(root)) !== resolve(root)
    )
      throw new Error("Recovery staging folder changed. It was not deleted.");
    await removeRecoveryStage(staging, journal);
  }
  async function cleanupMessage() {
    try {
      await cleanup();
      return "";
    } catch (error) {
      return ` Temporary clone retained at ${staging}. Cleanup failed: ${message(error)}`;
    }
  }
  // Nothing in the source changes until clone and checkout both succeed.
  try {
    await mkdir(fresh);
    freshIdentity = await lstat(fresh, { bigint: true });
    journal.freshDev = String(freshIdentity.dev);
    journal.freshIno = String(freshIdentity.ino);
    await writeFile(join(staging, "recovery.json"), JSON.stringify(journal));
    await run(
      "git",
      [
        "clone",
        ...(plan.branch ? ["--branch", plan.branch] : []),
        "--",
        plan.remote,
        fresh,
      ],
      { timeout: 180_000 },
    );
    const state = await gitState(fresh, run);
    if (!state.hasCommit || state.branch === "Detached HEAD")
      throw new Error(
        "The remote has no usable committed branch. Choose a branch before recovery.",
      );
    const cloned = await lstat(fresh, { bigint: true });
    if (
      cloned.dev !== freshIdentity.dev ||
      cloned.ino !== freshIdentity.ino ||
      cloned.isSymbolicLink()
    )
      throw new Error(
        "The temporary clone folder changed. Inspect it before recovery.",
      );
    await verifySource();
    const currentSource = await lstat(plan.source, { bigint: true });
    if (
      currentSource.isSymbolicLink() ||
      currentSource.dev !== sourceStat.dev ||
      currentSource.ino !== sourceStat.ino ||
      resolve(await realpath(plan.source)) !== resolve(plan.source)
    )
      throw new Error("The source folder changed. Inspect it again.");
    if (
      resolve(plan.source) !== resolve(plan.target) &&
      (await exists(plan.target))
    )
      throw new Error(`The destination already exists: ${plan.target}`);
    await moveProjectFolder(plan.source, old, plan.cloudMove);
  } catch (error) {
    const retained = await cleanupMessage();
    throw new Error(`Original folder unchanged. ${message(error)}${retained}`);
  }
  let installed = false;
  let result: T;
  try {
    await rename(fresh, plan.target);
    installed = true;
    result = await register(async (path) => {
      const stat = await lstat(path, { bigint: true });
      createdLink = { path, dev: stat.dev, ino: stat.ino };
    });
  } catch (error) {
    try {
      if (createdLink && (await exists(createdLink.path))) {
        const stat = await lstat(createdLink.path, { bigint: true });
        if (
          stat.isSymbolicLink() &&
          stat.dev === createdLink.dev &&
          stat.ino === createdLink.ino &&
          resolve(await realpath(createdLink.path)) === resolve(plan.target)
        )
          await rm(createdLink.path);
      }
      if (installed) {
        const current = await lstat(plan.target, { bigint: true });
        if (
          current.dev !== freshIdentity.dev ||
          current.ino !== freshIdentity.ino ||
          current.isSymbolicLink()
        )
          throw new Error(`The recovered folder changed: ${plan.target}`);
        await rename(plan.target, fresh);
      }
      if (await exists(plan.source))
        throw new Error(`The source path is now occupied: ${plan.source}`);
      await rename(old, plan.source);
    } catch (rollback) {
      throw new Error(
        `Recovery failed: ${message(error)} Original files retained at ${old}. Restore failed: ${message(rollback)}`,
      );
    }
    const retained = await cleanupMessage();
    throw new Error(`Original folder restored. ${message(error)}${retained}`);
  }
  try {
    await cleanup();
  } catch (error) {
    result.warning = [
      result.warning,
      `Recovered project is ready. Could not remove displaced local files at ${old}: ${message(error)}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return result;
}
