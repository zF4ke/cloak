import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Protection } from "../src/core/protection.ts";
import { run } from "../src/core/commands.ts";

test(
  "protection upgrade preserves configuration and prior running state",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "cloak-protection-upgrade-"));
    const state = join(root, "state"),
      scripts = join(root, "scripts");
    await mkdir(state);
    await mkdir(scripts);
    const started = join(state, "started.json");
    const runs = join(state, "runs.jsonl");
    const stub = (version: string) =>
      `param([string]$ConfigPath)\n$record = @{pid=$PID;version='${version}'} | ConvertTo-Json -Compress\n[IO.File]::WriteAllText('${started.replaceAll("'", "''")}', $record)\n[IO.File]::AppendAllText('${runs.replaceAll("'", "''")}', $record + [Environment]::NewLine)\nwhile ($true) { Start-Sleep -Seconds 1 }\n`;
    const deployed = join(state, "cloakd.ps1");
    const config = join(state, "config.jsonc");
    let child: ReturnType<typeof spawn> | undefined;
    let replacement: number | undefined;
    const waitFor = async (version: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const status = await readFile(started, "utf8").then(
          (raw) => JSON.parse(raw),
          () => undefined,
        );
        if (status?.version === version) return status.pid as number;
        await setTimeout(100);
      }
      throw new Error(`Fixture daemon ${version} did not start.`);
    };
    try {
      await writeFile(config, '{"keep":"owner settings"}');
      await writeFile(deployed, stub("old"));
      await writeFile(join(scripts, "cloakd.ps1"), stub("new"));
      await copyFile(
        resolve("refresh-protection.ps1"),
        join(scripts, "refresh-protection.ps1"),
      );
      const protection = new Protection(scripts, state, run, false);
      // A stopped daemon updates without silently starting protection.
      await protection.refresh();
      await assert.rejects(readFile(started), { code: "ENOENT" });
      assert.equal(await readFile(config, "utf8"), '{"keep":"owner settings"}');
      await writeFile(deployed, stub("old"));
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-File", deployed, "-ConfigPath", config],
        { windowsHide: true, stdio: "ignore" },
      );
      assert.equal(await waitFor("old"), child.pid);
      await Promise.all([
        protection.refresh(),
        new Protection(scripts, state, run, false).refresh(),
      ]);
      replacement = await waitFor("new");
      assert.notEqual(replacement, child.pid);
      assert.equal(await readFile(config, "utf8"), '{"keep":"owner settings"}');
      assert.equal(await readFile(deployed, "utf8"), stub("new"));
      assert.equal(
        (await readFile(runs, "utf8"))
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line))
          .filter((entry) => entry.version === "new").length,
        1,
      );
      await protection.refresh();
      assert.equal(await waitFor("new"), replacement);
    } finally {
      if (child?.exitCode === null) child.kill();
      if (replacement) process.kill(replacement);
      await setTimeout(300);
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 250,
      });
    }
  },
);
