import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Service } from "../src/core/service.ts";
import type { Run } from "../src/core/commands.ts";

test("snapshot recognizes a signed-in GitHub CLI without auth status JSON support", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloak-gh-status-"));
  let service: Service | undefined;
  try {
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify({
        version: 1,
        projects: [],
        settings: {
          projectsFolder: join(root, "projects"),
          linksFolder: join(root, "links"),
          createLinks: false,
          autoPull: false,
          pollMinutes: 5,
          launchAtLogin: false,
          behindEdits: "keep",
        },
      }),
    );
    let failure: "missing" | "auth" | "api" | undefined;
    const execute: Run = async (command, args) => {
      if (command !== "gh")
        return command === "git" ? "git version fixture" : "{}";
      if (failure === "missing" || args[0] === failure)
        throw new Error("fixture failure");
      if (args.includes("--json")) throw new Error("unknown flag: --json");
      if (args[0] === "--version") return "gh version 2.76.0";
      if (args[0] === "auth") return "Logged in to github.com account fixture";
      if (args[0] === "api") return "fixture";
      throw new Error("Unexpected GitHub command");
    };
    service = new Service(root, process.cwd(), false, execute);
    await service.initialize();
    assert.deepEqual((await service.snapshot()).github, {
      available: true,
      login: "fixture",
    });
    failure = "missing";
    assert.equal((await service.snapshot()).github.available, false);
    failure = "auth";
    const signedOut = (await service.snapshot()).github;
    assert.equal(signedOut.available, true);
    assert.match(signedOut.error!, /verify your sign-in/);
    failure = "api";
    const disconnected = (await service.snapshot()).github;
    assert.equal(disconnected.available, true);
    assert.match(disconnected.error!, /connection/);
  } finally {
    service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
