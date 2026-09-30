import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, rename, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FolderUnlocker } from "../src/core/folder-locks.ts";
import { exists } from "../src/core/paths.ts";
import { run } from "../src/core/commands.ts";

const tool = join(
  process.env.LOCALAPPDATA || "",
  "PowerToys",
  "FileLocksmithCLI.exe",
);
test("missing PowerToys keeps manual recovery available and invalid tickets never close apps", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
  try {
    const unlocker = new FolderUnlocker(resolve("."), run, []);
    const report = await unlocker.inspect(root);
    assert.equal(report.available, false);
    assert.match(report.message!, /Install Microsoft PowerToys/);
    await assert.rejects(
      unlocker.close("invalid", true),
      /Check locking apps again/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "File Locksmith finds a real directory handle; normal close retains headless tasks and explicit end releases it",
  { skip: process.platform !== "win32" },
  async (context) => {
    if (!(await exists(tool))) {
      context.skip("PowerToys is not installed");
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
    const child = spawn(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n'); process.stdin.resume()"],
      { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      await once(child.stdout!, "data");
      const unlocker = new FolderUnlocker(resolve("."), run, [tool]);
      const report = await unlocker.inspect(root);
      assert.equal(
        report.apps.some((app) => app.pid === child.pid && !app.protected),
        true,
      );
      const normal = await unlocker.close(report.token!, false);
      assert.equal(child.exitCode, null);
      assert.equal(
        normal.apps.some((app) => app.pid === child.pid),
        true,
      );
      const ended = await unlocker.close(normal.token!, true);
      assert.equal(
        ended.apps.some((app) => app.pid === child.pid),
        false,
      );
      await assert.rejects(
        unlocker.close(normal.token!, true),
        /Check locking apps again/,
      );
      await rename(root, `${root}-released`);
      await rename(`${root}-released`, root);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "the helper protects Cloak's process and ancestors even if a scanner reports them",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
    try {
      const execute: typeof run = (command, args, options) =>
        command === process.execPath
          ? Promise.resolve(
              JSON.stringify({
                processes: [
                  { pid: process.pid, name: "fixture" },
                  { pid: 4, name: "System" },
                ],
              }),
            )
          : run(command, args, options);
      const unlocker = new FolderUnlocker(resolve("."), execute, [
        process.execPath,
      ]);
      const report = await unlocker.inspect(root);
      assert.equal(report.apps[0]?.protected, true);
      const ended = await unlocker.close(report.token!, true);
      assert.equal(ended.apps[0]?.pid, process.pid);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "a holder exiting between rescan and close is skipped without aborting the refreshed report",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdout.write('ready\\n');process.stdin.resume();process.stdin.on('data',()=>process.exit(0))",
      ],
      { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      await once(child.stdout!, "data");
      let scans = 0;
      const execute: typeof run = async (command, args, options) => {
        if (command !== process.execPath) return run(command, args, options);
        const processes =
          child.exitCode === null ? [{ pid: child.pid, name: "fixture" }] : [];
        if (++scans === 2) {
          const exited = once(child, "exit");
          child.stdin!.write("quit\n");
          await exited;
        }
        return JSON.stringify({ processes });
      };
      const unlocker = new FolderUnlocker(resolve("."), execute, [
        process.execPath,
      ]);
      const report = await unlocker.inspect(root);
      assert.equal(report.apps[0]?.pid, child.pid);
      assert.deepEqual((await unlocker.close(report.token!, false)).apps, []);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "a process start-time mismatch prevents ending the task",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
    const child = spawn(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n');process.stdin.resume()"],
      { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      await once(child.stdout!, "data");
      let inspectCalls = 0;
      const execute: typeof run = async (command, args, options) => {
        if (command === process.execPath)
          return JSON.stringify({
            processes: [{ pid: child.pid, name: "fixture" }],
          });
        const output = await run(command, args, options);
        const payload = JSON.parse(
          Buffer.from(args.at(-1)!, "base64").toString(),
        );
        if (payload.action === "inspect" && ++inspectCalls === 1) {
          const apps = JSON.parse(output);
          apps[0].started = "wrong";
          return JSON.stringify(apps);
        }
        return output;
      };
      const unlocker = new FolderUnlocker(resolve("."), execute, [
        process.execPath,
      ]);
      const report = await unlocker.inspect(root);
      const result = await unlocker.close(report.token!, true);
      assert.equal(child.exitCode, null);
      assert.equal(result.apps[0]?.pid, child.pid);
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
test("a substituted folder invalidates the close ticket before any process action", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-unlock-"));
  try {
    const execute: typeof run = async (command) =>
      command === process.execPath ? '{"processes":[]}' : "[]";
    const unlocker = new FolderUnlocker(resolve("."), execute, [
      process.execPath,
    ]);
    const report = await unlocker.inspect(root);
    await rename(root, `${root}-original`);
    await mkdir(root);
    await assert.rejects(unlocker.close(report.token!, true), /folder changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}-original`, { recursive: true, force: true });
  }
});
