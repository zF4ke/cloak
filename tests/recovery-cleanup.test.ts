import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  lstat,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cleanupRecoveries } from "../src/core/recovery-cleanup.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloak-cleanup-"));
  const staging = join(root, ".cloak-recovery-test"),
    target = join(root, "project");
  await mkdir(staging);
  const stat = await lstat(staging, { bigint: true });
  const journal = {
    version: 1,
    pid: process.pid,
    target,
    dev: String(stat.dev),
    ino: String(stat.ino),
    freshDev: "",
    freshIno: "",
    oldDev: "",
    oldIno: "",
  };
  const save = async () => {
    for (const name of ["fresh", "old"] as const) {
      const child = await lstat(join(staging, name), { bigint: true }).catch(
        () => undefined,
      );
      if (child) {
        journal[`${name}Dev`] = String(child.dev);
        journal[`${name}Ino`] = String(child.ino);
      }
    }
    await writeFile(join(staging, "recovery.json"), JSON.stringify(journal));
  };
  await save();
  return {
    root,
    staging,
    target,
    journal,
    save,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test("cleanup removes an abandoned clone and ignores ordinary project folders", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "fresh"));
    await writeFile(join(f.staging, "fresh", "partial"), "large clone");
    await f.save();
    await mkdir(f.target);
    await writeFile(join(f.target, "keep"), "project");
    assert.deepEqual(await cleanupRecoveries(f.root, []), []);
    assert.deepEqual(await readdir(f.root), ["project"]);
  } finally {
    await f.close();
  }
});
test("interrupted swaps retain originals but remove the extra clone", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "old"));
    await writeFile(join(f.staging, "old", ".env"), "only original");
    await mkdir(join(f.staging, "fresh"));
    await writeFile(join(f.staging, "fresh", "partial"), "clone");
    await f.save();
    assert.match(
      (await cleanupRecoveries(f.root, []))[0]!,
      /Original files need restoration/,
    );
    assert.equal(
      await readFile(join(f.staging, "old", ".env"), "utf8"),
      "only original",
    );
    assert.deepEqual(await readdir(f.staging), ["old", "recovery.json"]);
  } finally {
    await f.close();
  }
});
test("registered replacement identity permits deletion of displaced originals without following links", async () => {
  const f = await fixture();
  try {
    const external = join(f.root, "external");
    await mkdir(external);
    await writeFile(join(external, "keep"), "external");
    await mkdir(join(f.staging, "old"));
    await symlink(
      external,
      join(f.staging, "old", "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await mkdir(f.target);
    const target = await lstat(f.target, { bigint: true });
    f.journal.freshDev = String(target.dev);
    f.journal.freshIno = String(target.ino);
    await f.save();
    assert.deepEqual(await cleanupRecoveries(f.root, [f.target]), []);
    assert.equal(await readFile(join(external, "keep"), "utf8"), "external");
    assert.deepEqual(await readdir(f.root), ["external", "project"]);
  } finally {
    await f.close();
  }
});
test("a crash after installation releases the unregistered clone but preserves the original", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "old"));
    await writeFile(join(f.staging, "old", "keep"), "original");
    await mkdir(f.target);
    const stat = await lstat(f.target, { bigint: true });
    f.journal.freshDev = String(stat.dev);
    f.journal.freshIno = String(stat.ino);
    await f.save();
    assert.match(
      (await cleanupRecoveries(f.root, []))[0]!,
      /Original files need restoration/,
    );
    assert.equal(
      await readFile(join(f.staging, "old", "keep"), "utf8"),
      "original",
    );
    assert.deepEqual(await readdir(f.root), [".cloak-recovery-test"]);
  } finally {
    await f.close();
  }
});
test("cleanup keeps an unrelated destination beside an interrupted original", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "old"));
    await mkdir(f.target);
    await writeFile(join(f.target, "keep"), "other project");
    await f.save();
    assert.match(
      (await cleanupRecoveries(f.root, []))[0]!,
      /Original files need restoration/,
    );
    assert.equal(
      await readFile(join(f.target, "keep"), "utf8"),
      "other project",
    );
  } finally {
    await f.close();
  }
});
test("cleanup refuses missing records, wrong identities and another live owner", async () => {
  const f = await fixture();
  try {
    await rm(join(f.staging, "recovery.json"));
    assert.match((await cleanupRecoveries(f.root, []))[0]!, /cleanup pending/);
    f.journal.ino = "wrong";
    await f.save();
    assert.match((await cleanupRecoveries(f.root, []))[0]!, /invalid/);
    f.journal.ino = String((await lstat(f.staging, { bigint: true })).ino);
    f.journal.pid = process.ppid;
    await f.save();
    assert.deepEqual(await cleanupRecoveries(f.root, []), []);
    assert.equal((await lstat(f.staging)).isDirectory(), true);
  } finally {
    await f.close();
  }
});
test(
  "failed displaced-folder deletion retains its retry record until the Windows lock closes",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await mkdir(join(f.staging, "old"));
      await mkdir(f.target);
      const target = await lstat(f.target, { bigint: true });
      f.journal.freshDev = String(target.dev);
      f.journal.freshIno = String(target.ino);
      await f.save();
      child = spawn(
        process.execPath,
        [
          "-e",
          "process.stdout.write('ready\\n'); process.stdin.resume(); process.stdin.on('data',()=>process.exit(0))",
        ],
        {
          cwd: join(f.staging, "old"),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      await once(child.stdout!, "data");
      assert.match(
        (await cleanupRecoveries(f.root, [f.target]))[0]!,
        /cleanup pending/,
      );
      assert.equal(
        JSON.parse(await readFile(join(f.staging, "recovery.json"), "utf8"))
          .version,
        1,
      );
      const exited = once(child, "exit");
      child.stdin!.write("quit\n");
      await exited;
      assert.deepEqual(await cleanupRecoveries(f.root, [f.target]), []);
      assert.deepEqual(await readdir(f.root), ["project"]);
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await f.close();
    }
  },
);
test("changed disposable child identity prevents unattended deletion", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "fresh"));
    await writeFile(join(f.staging, "fresh", "keep"), "changed clone");
    await f.save();
    f.journal.freshIno = "wrong";
    await writeFile(
      join(f.staging, "recovery.json"),
      JSON.stringify(f.journal),
    );
    assert.match(
      (await cleanupRecoveries(f.root, []))[0]!,
      /fresh folder changed/,
    );
    assert.equal(
      await readFile(join(f.staging, "fresh", "keep"), "utf8"),
      "changed clone",
    );
  } finally {
    await f.close();
  }
});
test("an altered original prevents deletion of an unregistered installed clone", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.staging, "old"));
    await mkdir(f.target);
    await writeFile(join(f.target, "keep"), "verified clone");
    const stat = await lstat(f.target, { bigint: true });
    f.journal.freshDev = String(stat.dev);
    f.journal.freshIno = String(stat.ino);
    await f.save();
    f.journal.oldIno = "wrong";
    await writeFile(
      join(f.staging, "recovery.json"),
      JSON.stringify(f.journal),
    );
    assert.match(
      (await cleanupRecoveries(f.root, []))[0]!,
      /old folder changed/,
    );
    assert.equal(
      await readFile(join(f.target, "keep"), "utf8"),
      "verified clone",
    );
  } finally {
    await f.close();
  }
});
test("a redirected staging folder cannot cause deletion outside the recovery root", async () => {
  const f = await fixture();
  const external = await mkdtemp(join(tmpdir(), "cloak-cleanup-external-"));
  try {
    await writeFile(join(external, "keep"), "external");
    await rm(f.staging, { recursive: true });
    await symlink(
      external,
      f.staging,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.deepEqual(await cleanupRecoveries(f.root, []), []);
    assert.equal(await readFile(join(external, "keep"), "utf8"), "external");
  } finally {
    await f.close();
    await rm(external, { recursive: true, force: true });
  }
});
