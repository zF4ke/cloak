import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("packaging refuses redirected output before deleting any files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-package-"));
  try {
    const repository = join(root, "repo"),
      external = join(root, "external");
    await mkdir(repository);
    await mkdir(join(external, "Cloak"), { recursive: true });
    await writeFile(join(repository, "package.json"), '{"version":"0.2.0"}');
    await writeFile(join(external, "Cloak", "keep.txt"), "untouched");
    await symlink(
      external,
      join(repository, "release"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, [resolve("scripts/package.mjs")], {
          cwd: repository,
          stdio: "pipe",
          windowsHide: true,
        }),
      /Refusing a redirected release folder/,
    );
    assert.equal(
      await readFile(join(external, "Cloak", "keep.txt"), "utf8"),
      "untouched",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
