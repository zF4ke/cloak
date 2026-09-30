import { lstat, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Run } from "./commands.ts";
import { gitState } from "./git.ts";
import { exists, inside } from "./paths.ts";

type Recovery = {
  source: string;
  target: string;
  root: string;
  remote: string;
  branch?: string;
  link?: string;
};

/** Clone first, swap whole folders, register, then delete only the displaced folder. */
export async function replaceFromRemote<T extends { warning?: string }>(
  plan: Recovery,
  run: Run,
  verifySource: () => Promise<void>,
  register: () => Promise<T>,
): Promise<T> {
  await mkdir(plan.root, { recursive: true });
  const root = await realpath(plan.root);
  if (!inside(root, plan.target) || resolve(plan.target) === resolve(root))
    throw new Error(
      "Recovery destination must be inside the real project folder.",
    );
  const sourceStat = await lstat(plan.source);
  const preserveLink = Boolean(
    plan.link &&
    resolve(plan.link) !== resolve(plan.source) &&
    (await exists(plan.link)),
  );
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
  const fresh = join(staging, "fresh"),
    old = join(staging, "old");
  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  async function cleanup() {
    if (
      !inside(root, staging) ||
      resolve(await realpath(staging)) !== resolve(staging) ||
      resolve(await realpath(root)) !== resolve(root)
    )
      throw new Error("Recovery staging folder changed. It was not deleted.");
    await rm(staging, { recursive: true });
  }
  // Nothing in the source changes until clone and checkout both succeed.
  try {
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
    await verifySource();
    if (
      (await lstat(plan.source)).isSymbolicLink() ||
      resolve(await realpath(plan.source)) !== resolve(plan.source)
    )
      throw new Error("The source folder changed. Inspect it again.");
    if (
      resolve(plan.source) !== resolve(plan.target) &&
      (await exists(plan.target))
    )
      throw new Error(`The destination already exists: ${plan.target}`);
    await rename(plan.source, old);
  } catch (error) {
    await cleanup().catch(() => {});
    throw new Error(`Original folder unchanged. ${message(error)}`);
  }
  let installed = false;
  let result: T;
  try {
    await rename(fresh, plan.target);
    installed = true;
    result = await register();
  } catch (error) {
    try {
      if (plan.link && !preserveLink && (await exists(plan.link))) {
        const stat = await lstat(plan.link);
        if (
          stat.isSymbolicLink() &&
          resolve(await realpath(plan.link)) === resolve(plan.target)
        )
          await rm(plan.link);
      }
      if (installed) await rename(plan.target, fresh);
      if (await exists(plan.source))
        throw new Error(`The source path is now occupied: ${plan.source}`);
      await rename(old, plan.source);
    } catch (rollback) {
      throw new Error(
        `Recovery failed: ${message(error)} Original files retained at ${old}. Restore failed: ${message(rollback)}`,
      );
    }
    await cleanup().catch(() => {});
    throw new Error(`Original folder restored. ${message(error)}`);
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
