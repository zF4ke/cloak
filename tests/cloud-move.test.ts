import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  lstat,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run, type Run } from "../src/core/commands.ts";
import { moveProjectFolder } from "../src/core/paths.ts";
import { moveCloudFolder } from "../src/core/cloud-move.ts";

test(
  "cloud-filter UNKNOWN rename resumes the provider and moves the whole folder",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-cloud-"));
    const cloud = join(root, "cloud"),
      state = join(root, "state"),
      target = join(root, "moved");
    await mkdir(cloud);
    await mkdir(state);
    const fixture = resolve("tests/fixtures/cloud-folder.ps1");
    const unregister = () =>
      run("powershell.exe", [
        "-NoProfile",
        "-File",
        fixture,
        "-Root",
        cloud,
        "-Cleanup",
      ]);
    let resumed = false;
    try {
      await run("powershell.exe", [
        "-NoProfile",
        "-File",
        fixture,
        "-Root",
        cloud,
      ]);
      const source = join(cloud, "project");
      await assert.rejects(
        moveProjectFolder(source, target),
        /Windows blocked moving/,
      );
      let original: bigint | undefined;
      const execute: Run = async (command, args, options) => {
        const request = JSON.parse(
          Buffer.from(args.at(-1)!, "base64").toString(),
        );
        if (request.action === "resume") {
          const leases = (await readdir(state)).filter((file) =>
            file.startsWith("cloud-access-"),
          );
          assert.equal(leases.length, 1);
          assert.equal(
            JSON.parse(await readFile(join(state, leases[0]!), "utf8")).pid,
            process.pid,
          );
          // Simulate a ready provider by unregistering this isolated fixture.
          // The test never starts/stops the user's OneDrive or touches projects.
          await unregister();
          original = (await lstat(source, { bigint: true })).ino;
          await writeFile(join(source, "keep.txt"), "local contents");
          resumed = true;
          return '{"resumed":true}';
        }
        return run(command, args, options);
      };
      await moveProjectFolder(source, target, {
        scripts: resolve("."),
        directory: state,
        run: execute,
      });
      assert.equal(resumed, true);
      assert.equal((await lstat(target, { bigint: true })).ino, original);
      assert.equal(
        await readFile(join(target, "keep.txt"), "utf8"),
        "local contents",
      );
      assert.equal((await readdir(state)).length, 0);
      await assert.rejects(lstat(source), { code: "ENOENT" });
    } finally {
      await unregister();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "native cloud move never replaces an existing destination or mismatched source",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-cloud-"));
    try {
      const source = join(root, "source"),
        target = join(root, "target");
      await mkdir(source);
      await mkdir(target);
      await writeFile(join(source, "keep.txt"), "source");
      await writeFile(join(target, "keep.txt"), "target");
      const execute: Run = (command, args, settings) => {
        const request = JSON.parse(
          Buffer.from(args.at(-1)!, "base64").toString(),
        );
        return request.action === "resume"
          ? Promise.resolve('{"resumed":true}')
          : run(command, args, settings);
      };
      const options = { scripts: resolve("."), directory: root, run: execute };
      await assert.rejects(
        moveCloudFolder(source, target, options),
        /Windows could not move/,
      );
      assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "target");
      const substituted: Run = async (command, args, settings) => {
        const payload = JSON.parse(
          Buffer.from(args.at(-1)!, "base64").toString(),
        );
        if (payload.action === "resume") return '{"resumed":true}';
        payload.ino = "0";
        args[args.length - 1] = Buffer.from(JSON.stringify(payload)).toString(
          "base64",
        );
        return run(command, args, settings);
      };
      await assert.rejects(
        moveCloudFolder(source, join(root, "new"), {
          ...options,
          run: substituted,
        }),
        /folder changed/,
      );
      assert.equal(await readFile(join(source, "keep.txt"), "utf8"), "source");
      await moveCloudFolder(source, join(root, "new"), options);
      assert.equal(
        await readFile(join(root, "new", "keep.txt"), "utf8"),
        "source",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "a failed provider restart removes its lease and retains the cloud source",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-cloud-"));
    try {
      const source = join(root, "source");
      await mkdir(source);
      const execute: Run = async (_command, args) => {
        const request = JSON.parse(
          Buffer.from(args.at(-1)!, "base64").toString(),
        );
        if (request.action === "resume")
          throw new Error("OneDrive is unavailable.");
        return '{"code":362,"message":"provider not running"}';
      };
      await assert.rejects(
        moveCloudFolder(source, join(root, "new"), {
          scripts: resolve("."),
          directory: root,
          run: execute,
        }),
        /OneDrive is unavailable/,
      );
      assert.deepEqual(await readdir(root), ["source"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
