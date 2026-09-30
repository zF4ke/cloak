import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withProjectLock } from "../src/core/lock.ts";

function child(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, args, {
      windowsHide: true,
      stdio: "inherit",
    });
    process.once("error", reject);
    process.once("exit", (code) =>
      code === 0
        ? resolve(process.pid!)
        : reject(new Error(`Worker exited ${code}`)),
    );
  });
}
test("multiple processes recover a dead owner once and serialize subsequent work", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-lock-"));
  try {
    const pid = await child(["-e", "process.exit(0)"]);
    const token = randomUUID();
    await mkdir(join(root, "projects.lock"));
    await writeFile(
      join(root, "projects.lock", "owner.json"),
      JSON.stringify({ pid, token }),
    );
    await writeFile(join(root, "counter"), "0");
    const workers = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        child([resolve("tests/lock-worker.ts"), root]),
      ),
    );
    for (const worker of workers)
      if (worker.status === "rejected") throw worker.reason;
    assert.equal(await readFile(join(root, "counter"), "utf8"), "40");
    assert.equal(
      JSON.parse(
        await readFile(
          join(root, `projects.recovered-${token}`, "owner.json"),
          "utf8",
        ),
      ).pid,
      pid,
    );
    await withProjectLock(root, async () =>
      assert.ok(
        JSON.parse(
          await readFile(join(root, "projects.lock", "owner.json"), "utf8"),
        ).token,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
