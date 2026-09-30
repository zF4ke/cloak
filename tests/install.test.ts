import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../src/setup/install.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloak-install-"));
  const source = join(root, "source"),
    data = join(root, "profile");
  await mkdir(join(source, "resources"), { recursive: true });
  await mkdir(data);
  await writeFile(join(source, "Cloak.exe"), "new application");
  await writeFile(
    join(source, "resources", "package.json"),
    '{"version":"0.2.0"}',
  );
  await writeFile(join(data, "projects.json"), "user projects");
  return {
    root,
    source,
    data,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test("install and update replace application files and retain user data", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.data, "app"));
    await writeFile(join(f.data, "app", "Cloak.exe"), "old application");
    await writeFile(join(f.data, "app", "obsolete"), "old");
    const progress: number[] = [];
    const target = await install(
      f.source,
      f.data,
      (value) => progress.push(value),
      {
        running: async () => false,
        register: async (path) => {
          assert.equal(path, join(f.data, "app"));
        },
      },
    );
    assert.equal(
      await readFile(join(target, "Cloak.exe"), "utf8"),
      "new application",
    );
    assert.equal(
      await readFile(join(f.data, "projects.json"), "utf8"),
      "user projects",
    );
    assert.deepEqual((await readdir(f.data)).sort(), ["app", "projects.json"]);
    assert.equal(progress.at(-1), 100);
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]!));
  } finally {
    await f.close();
  }
});
test("registration failure rolls application files back", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.data, "app"));
    await writeFile(join(f.data, "app", "Cloak.exe"), "old");
    await assert.rejects(
      install(f.source, f.data, () => {}, {
        running: async () => false,
        register: async () => {
          throw new Error("shortcut failed");
        },
      }),
      /shortcut failed/,
    );
    assert.equal(
      await readFile(join(f.data, "app", "Cloak.exe"), "utf8"),
      "old",
    );
    assert.deepEqual((await readdir(f.data)).sort(), ["app", "projects.json"]);
  } finally {
    await f.close();
  }
});
test("setup refuses running applications and folder links", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      install(f.source, f.data, () => {}, {
        running: async () => true,
        register: async () => {},
      }),
      /running/,
    );
    await symlink(
      f.source,
      join(f.data, "app"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      install(f.source, f.data, () => {}, {
        running: async () => false,
        register: async () => {},
      }),
      /app folder is a link/,
    );
    assert.equal(
      await readFile(join(f.source, "Cloak.exe"), "utf8"),
      "new application",
    );
  } finally {
    await f.close();
  }
});
