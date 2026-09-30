import type { Run } from "./commands.ts";
import type { GitState } from "../shared/types.ts";
export async function gitState(path: string, run: Run): Promise<GitState> {
  const git = (...args: string[]) => run("git", ["-C", path, ...args]);
  const branch = await git("symbolic-ref", "--short", "HEAD").catch(
    () => "Detached HEAD",
  );
  const remote = await git("remote", "get-url", "origin").catch(
    () => undefined,
  );
  const hasCommit = await git("rev-parse", "--verify", "HEAD").then(
    () => true,
    () => false,
  );
  const raw = await git(
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  );
  const entries = raw.split("\0"),
    changes: GitState["changes"] = [];
  // execFile output is not trimmed for status: whitespace is part of its format.
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    changes.push({ status: entry.slice(0, 2), path: entry.slice(3) });
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  const counts = await git(
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{upstream}",
  ).catch(() => "0\t0");
  const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number);
  return { branch, remote, hasCommit, changes, ahead, behind };
}
export function githubUrl(value: string): string {
  const text = value.trim();
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(text))
    return text;
  try {
    const url = new URL(text);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)
    )
      return url.href;
  } catch {}
  throw new Error("Use a GitHub repository URL.");
}
export function browserRepository(value: string): string {
  return githubUrl(value)
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git\/?$/, "");
}
