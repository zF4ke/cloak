import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { folderPickerPath } from "../src/core/folder-picker.ts";
import { Service } from "../src/core/service.ts";

test("folder picker prefers current folders and falls back for missing or partial paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-picker-"));
  try {
    const current = join(root, "current"),
      fallback = join(root, "projects");
    await mkdir(current);
    await mkdir(fallback);
    await writeFile(join(root, "file"), "fixture");
    assert.equal(await folderPickerPath(current, fallback), current);
    assert.equal(
      await folderPickerPath(join(current, "missing"), fallback),
      fallback,
    );
    assert.equal(await folderPickerPath("partial", fallback), fallback);
    assert.equal(
      await folderPickerPath(join(root, "file"), fallback),
      fallback,
    );
    assert.equal(
      await folderPickerPath(undefined, join(root, "missing", "projects")),
      root,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("folder picker service routes local and OneDrive contexts and validates IPC options", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-picker-service-"));
  let service: Service | undefined;
  try {
    const local = join(root, "local"),
      cloud = join(root, "OneDriveProjects");
    await mkdir(local);
    await mkdir(cloud);
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify({
        version: 1,
        projects: [],
        settings: {
          projectsFolder: local,
          linksFolder: cloud,
          createLinks: true,
          autoPull: false,
          pollMinutes: 5,
          launchAtLogin: false,
          behindEdits: "keep",
        },
      }),
    );
    const calls: (string | undefined)[] = [];
    service = new Service(root, process.cwd(), false, undefined, {
      chooseFolder: async (path) => {
        calls.push(path);
        return undefined;
      },
    });
    await service.initialize();
    await service.call("chooseFolder", []);
    await service.call("chooseFolder", [{ location: "onedrive" }]);
    await service.call("chooseFolder", [{ location: "projects", path: cloud }]);
    assert.deepEqual(calls, [local, cloud, cloud]);
    await assert.rejects(
      service.call("chooseFolder", [{ location: "unknown" }]),
      /Invalid folder picker/,
    );
    await assert.rejects(
      service.call("chooseFolder", [{ path: 42 }]),
      /Invalid folder picker/,
    );
    await assert.rejects(
      service.call("chooseFolder", [null]),
      /Invalid folder picker/,
    );
    assert.equal(calls.length, 3);
  } finally {
    service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
