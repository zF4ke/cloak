import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
  lstat,
  rm,
  symlink,
  rename,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Projects } from "../src/core/projects.ts";
import { gitState } from "../src/core/git.ts";
import { run, type Run } from "../src/core/commands.ts";
import type { Settings } from "../src/shared/types.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cloak-test-")),
    cloud = join(root, "OneDrive"),
    local = join(root, "local"),
    seed = join(root, "seed"),
    remote = join(root, "remote.git");
  await mkdir(cloud);
  await mkdir(local);
  await run("git", ["init", "--bare", remote]);
  await run("git", ["init", "-b", "main", seed]);
  const git = (path: string, ...args: string[]) =>
    run("git", ["-C", path, ...args]);
  await git(seed, "config", "user.name", "Cloak test");
  await git(seed, "config", "user.email", "cloak@test.invalid");
  await writeFile(join(seed, "README.md"), "initial\n");
  await writeFile(join(seed, ".gitignore"), ".env\n*.sqlite\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-m", "initial");
  await git(seed, "remote", "add", "origin", remote);
  await git(seed, "push", "-u", "origin", "main");
  const source = join(cloud, "project");
  await run("git", ["clone", "--branch", "main", remote, source]);
  await git(source, "config", "user.name", "Cloak test");
  await git(source, "config", "user.email", "cloak@test.invalid");
  const settings: Settings = {
    projectsFolder: local,
    linksFolder: cloud,
    createLinks: true,
    autoPull: true,
    pollMinutes: 5,
    launchAtLogin: false,
    behindEdits: "discard",
  };
  const projects = new Projects(join(root, "state"), settings, [cloud], run);
  await projects.initialize();
  const add = () =>
    projects.create({
      mode: "import",
      name: "project",
      source,
      useRemote: true,
      createRepository: false,
      visibility: "private",
    });
  const upstream = async () => {
    await writeFile(join(seed, "README.md"), "upstream\n");
    await git(seed, "add", "README.md");
    await git(seed, "commit", "-m", "upstream");
    await git(seed, "push", "origin", "main");
  };
  return {
    root,
    cloud,
    local,
    seed,
    source,
    remote,
    settings,
    projects,
    git,
    add,
    upstream,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test("ignored local files survive changed ignore rules and block incoming tracked collisions", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, ".env"), "local secret");
    await writeFile(join(f.seed, ".gitignore"), "*.sqlite\n");
    await f.git(f.seed, "add", ".gitignore");
    await f.git(f.seed, "commit", "-m", "change ignores");
    await f.git(f.seed, "push");
    await f.projects.checkUpdates();
    assert.equal(
      await readFile(join(project.path, ".env"), "utf8"),
      "local secret",
    );
    await writeFile(join(project.path, ".gitignore"), ".env\n*.sqlite\n");
    await writeFile(join(f.seed, ".env"), "remote content");
    await f.git(f.seed, "add", ".env");
    await f.git(f.seed, "commit", "-m", "track env");
    await f.git(f.seed, "push");
    const head = await f.git(project.path, "rev-parse", "HEAD");
    await f.projects.checkUpdates();
    assert.equal(
      await readFile(join(project.path, ".env"), "utf8"),
      "local secret",
    );
    assert.equal(await f.git(project.path, "rev-parse", "HEAD"), head);
    assert.match(
      (await f.projects.views())[0]?.update?.message ?? "",
      /ignored local files/,
    );
  } finally {
    await f.close();
  }
});
test(
  "Windows ignored paths block incoming case-variant names",
  { skip: process.platform !== "win32" },
  async () => {
    const f = await fixture();
    try {
      const { project } = await f.add();
      await writeFile(join(project.path, ".env"), "local secret");
      await writeFile(join(f.seed, ".ENV"), "remote");
      await f.git(f.seed, "add", "-f", ".ENV");
      await f.git(f.seed, "commit", "-m", "case variant");
      await f.git(f.seed, "push");
      const head = await f.git(project.path, "rev-parse", "HEAD");
      await f.projects.checkUpdates();
      assert.equal(await f.git(project.path, "rev-parse", "HEAD"), head);
      assert.equal(
        await readFile(join(project.path, ".env"), "utf8"),
        "local secret",
      );
      assert.match(
        (await f.projects.views())[0]?.update?.message ?? "",
        /ignored local files/,
      );
    } finally {
      await f.close();
    }
  },
);

test("selected names with Git wildcard characters are treated literally", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, "[ab].txt"), "selected");
    await writeFile(join(project.path, "a.txt"), "unselected");
    await assert.rejects(
      f.projects.sync(project.id, { message: "literal", files: ["[ab].txt"] }),
      /local changes/,
    );
    assert.equal(
      await f.git(project.path, "show", "HEAD:[ab].txt"),
      "selected",
    );
    await assert.rejects(f.git(project.path, "show", "HEAD:a.txt"));
  } finally {
    await f.close();
  }
});
test("import moves the whole folder outside OneDrive and creates a transparent folder link", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, ".env"), "secret");
    const result = await f.add();
    assert.equal(result.warning, undefined);
    assert.equal(await realpath(f.source), result.project.path);
    assert.equal((await lstat(f.source)).isSymbolicLink(), true);
    assert.equal(await readFile(join(f.source, ".env"), "utf8"), "secret");
    assert.equal((await f.projects.views())[0]?.git?.branch, "main");
    const again = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      run,
    );
    await again.initialize();
    assert.equal((await again.views())[0]?.id, result.project.id);
  } finally {
    await f.close();
  }
});
test("import registers a project already at the real destination without moving it", async () => {
  const f = await fixture();
  try {
    const target = join(f.local, "project");
    await rename(f.source, target);
    await writeFile(join(target, ".env"), "retained local data");
    const { project } = await f.projects.create({
      mode: "import",
      name: "project",
      source: target,
      useRemote: true,
      createRepository: false,
      visibility: "private",
    });
    assert.equal(project.path, target);
    assert.equal(
      await readFile(join(target, ".env"), "utf8"),
      "retained local data",
    );
    assert.equal(await realpath(project.link!), await realpath(target));
  } finally {
    await f.close();
  }
});

test("a failed initial link remains visible and can be repaired without moving the retained project", async () => {
  const f = await fixture();
  try {
    let obstructed = false;
    const execute: Run = async (command, args, options) => {
      if (
        !obstructed &&
        command === "git" &&
        args[0] === "-C" &&
        args[1] === join(f.local, "project")
      ) {
        await mkdir(f.source);
        obstructed = true;
      }
      return run(command, args, options);
    };
    const projects = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      execute,
    );
    const result = await projects.create({
      mode: "import",
      name: "project",
      source: f.source,
      useRemote: true,
      createRepository: false,
      visibility: "private",
    });
    assert.match(result.warning ?? "", /Folder link failed/);
    assert.equal((await projects.views())[0]?.linkMissing, true);
    assert.equal(result.project.link, f.source);
    await rm(f.source, { recursive: true });
    await projects.repairLink(result.project.id);
    assert.equal((await projects.views())[0]?.linkMissing, false);
    assert.equal(await realpath(f.source), await realpath(result.project.path));
    assert.equal(
      (await readFile(join(result.project.path, "README.md"), "utf8")).trim(),
      "initial",
    );
  } finally {
    await f.close();
  }
});

test("behind branches replace edits and untracked files, but retain ignored local data", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, "README.md"), "local edit");
    await writeFile(join(project.path, "draft.ts"), "draft");
    await writeFile(join(project.path, ".env"), "private");
    await writeFile(join(project.path, "data.sqlite"), "runtime");
    await f.upstream();
    await f.projects.checkUpdates();
    assert.equal(
      (await readFile(join(project.path, "README.md"), "utf8")).replace(
        /\r\n/g,
        "\n",
      ),
      "upstream\n",
    );
    await assert.rejects(readFile(join(project.path, "draft.ts")));
    assert.equal(await readFile(join(project.path, ".env"), "utf8"), "private");
    assert.equal(
      await readFile(join(project.path, "data.sqlite"), "utf8"),
      "runtime",
    );
    assert.equal((await gitState(project.path, run)).changes.length, 0);
  } finally {
    await f.close();
  }
});
test("equal branches leave uncommitted edits and new files untouched", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, "README.md"), "local");
    await writeFile(join(project.path, "new.ts"), "new");
    await f.projects.checkUpdates();
    assert.equal(
      await readFile(join(project.path, "README.md"), "utf8"),
      "local",
    );
    assert.equal(await readFile(join(project.path, "new.ts"), "utf8"), "new");
    const state = await gitState(project.path, run);
    assert.deepEqual(
      state.changes.find((c) => c.path === "README.md"),
      { path: "README.md", status: " M" },
    );
  } finally {
    await f.close();
  }
});
test("ahead and diverged branches keep their local commits", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, "local.ts"), "local");
    await f.git(project.path, "add", "local.ts");
    await f.git(project.path, "commit", "-m", "local");
    const head = await f.git(project.path, "rev-parse", "HEAD");
    await f.projects.checkUpdates();
    assert.equal(await f.git(project.path, "rev-parse", "HEAD"), head);
    await f.upstream();
    await f.projects.checkUpdates();
    assert.equal(await f.git(project.path, "rev-parse", "HEAD"), head);
    assert.match(
      (await f.projects.views())[0]?.update?.message ?? "",
      /commits differ/,
    );
  } finally {
    await f.close();
  }
});
test("keep policy refuses to replace edits on a behind branch", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await f.projects.saveSettings({ ...f.settings, behindEdits: "keep" });
    await writeFile(join(project.path, "README.md"), "local");
    await f.upstream();
    await f.projects.checkUpdates();
    assert.equal(
      await readFile(join(project.path, "README.md"), "utf8"),
      "local",
    );
    assert.match(
      (await f.projects.views())[0]?.update?.message ?? "",
      /local edits/,
    );
  } finally {
    await f.close();
  }
});
test("destination collisions and cloud-backed storage roots cannot move source files", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.local, "project"));
    await assert.rejects(f.add(), /destination already exists/);
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
    await assert.rejects(
      f.projects.saveSettings({
        ...f.settings,
        projectsFolder: join(f.cloud, "other"),
      }),
      /outside OneDrive/,
    );
    const alias = join(f.root, "alias");
    await symlink(
      f.cloud,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      f.projects.saveSettings({
        ...f.settings,
        projectsFolder: join(alias, "hidden"),
      }),
      /outside OneDrive/,
    );
  } finally {
    await f.close();
  }
});
test("a local commit during fetch is not overwritten", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await f.upstream();
    let fired = false;
    const racing: Run = async (command, args, options) => {
      if (!fired && command === "git" && args.includes("fetch")) {
        fired = true;
        await writeFile(join(project.path, "new.ts"), "new");
        await f.git(project.path, "add", "new.ts");
        await f.git(project.path, "commit", "-m", "concurrent");
      }
      return run(command, args, options);
    };
    const projects = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      racing,
    );
    await projects.initialize();
    await projects.checkUpdates();
    assert.equal(await readFile(join(project.path, "new.ts"), "utf8"), "new");
    assert.match(
      await f.git(project.path, "log", "-1", "--format=%s"),
      /concurrent/,
    );
  } finally {
    await f.close();
  }
});
test("manual sync commits only selected files and refuses hidden staged additions", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await writeFile(join(project.path, "README.md"), "edited");
    await writeFile(join(project.path, "new.ts"), "new");
    await f.git(project.path, "add", "new.ts");
    await assert.rejects(
      f.projects.sync(project.id, { message: "edit", files: ["README.md"] }),
      /Other files are already staged/,
    );
    await f.git(project.path, "restore", "--staged", "new.ts");
    await f.projects.sync(project.id, {
      message: "all",
      files: ["README.md", "new.ts"],
    });
    assert.equal((await gitState(project.path, run)).changes.length, 0);
    assert.equal(
      await f.git(project.path, "rev-parse", "HEAD"),
      await f.git(f.remote, "rev-parse", "refs/heads/main"),
    );
  } finally {
    await f.close();
  }
});

test("a renamed local branch updates and pushes its existing origin tracking branch", async () => {
  const f = await fixture();
  try {
    const { project } = await f.add();
    await f.git(project.path, "branch", "-m", "work");
    await f.upstream();
    await f.projects.checkUpdates();
    assert.equal(
      (await readFile(join(project.path, "README.md"), "utf8")).trim(),
      "upstream",
    );
    await writeFile(join(project.path, "new.ts"), "new");
    await f.projects.sync(project.id, { message: "update", files: ["new.ts"] });
    assert.equal(
      await f.git(project.path, "rev-parse", "HEAD"),
      await f.git(f.remote, "rev-parse", "refs/heads/main"),
    );
    await assert.rejects(f.git(f.remote, "rev-parse", "refs/heads/work"));
  } finally {
    await f.close();
  }
});

test("two service instances retain each other's registry changes", async () => {
  const f = await fixture();
  try {
    const second = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      run,
    );
    await second.initialize();
    const { project } = await f.add();
    await second.saveSettings({ ...f.settings, pollMinutes: 8 });
    assert.equal((await f.projects.views())[0]?.id, project.id);
    assert.equal(f.projects.settings().pollMinutes, 8);
  } finally {
    await f.close();
  }
});

test("an unreadable index exposes remote recovery without treating the folder as a new repository", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, ".git", "index"), "");
    await assert.rejects(f.git(f.source, "status"), /index/);
    const inspection = await f.projects.inspect(f.source);
    assert.equal(inspection.git, undefined);
    assert.equal(inspection.recovery?.remote, f.remote);
    assert.equal(inspection.recovery?.branch, "main");
    assert.match(inspection.recovery?.error ?? "", /index/);
    await assert.rejects(f.add(), /latest remote version/);
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
  } finally {
    await f.close();
  }
});

test("an unreadable Git folder cannot be imported as a new repository", async () => {
  const f = await fixture();
  try {
    const broken = join(f.cloud, "broken");
    await mkdir(join(broken, ".git"), { recursive: true });
    assert.match(
      (await f.projects.inspect(broken)).recovery?.error ?? "",
      /Git cannot read/,
    );
    await assert.rejects(
      f.projects.create({
        mode: "import",
        name: "broken",
        source: broken,
        useRemote: false,
        createRepository: true,
        visibility: "private",
      }),
      /latest remote version/,
    );
  } finally {
    await f.close();
  }
});

async function recoveryFixture() {
  const f = await fixture();
  const url = "https://github.com/cloak-test/project.git";
  await f.git(f.source, "remote", "set-url", "origin", url);
  const execute: Run = (command, args, options) =>
    run(
      command,
      args.map((arg) => (arg === url ? f.remote : arg)),
      options,
    );
  const projects = new Projects(
    join(f.root, "state"),
    f.settings,
    [f.cloud],
    execute,
  );
  await projects.initialize();
  const recover = (source = f.source) =>
    projects.create({
      mode: "import",
      name: "project",
      source,
      repository: url,
      visibility: "private",
      useRemote: true,
      createRepository: false,
      recovery: { confirmed: true, branch: "main" },
    });
  return { ...f, url, execute, projects, recover };
}

test("explicit recovery clones latest tracked branch, replaces all local files, and restores the folder link", async () => {
  const f = await recoveryFixture();
  try {
    await f.git(f.source, "branch", "-m", "work");
    await writeFile(join(f.source, "unpublished.txt"), "unpublished");
    await f.git(f.source, "add", ".");
    await f.git(f.source, "commit", "-m", "unpublished");
    await writeFile(join(f.source, ".env"), "ignored private file");
    await writeFile(join(f.source, "draft.txt"), "untracked");
    await writeFile(join(f.source, ".git", "index"), "");
    assert.equal((await f.projects.inspect(f.source)).recovery?.branch, "main");
    await f.upstream();
    const { project, warning } = await f.recover();
    assert.equal(warning, undefined);
    assert.equal(
      await f.git(project.path, "rev-parse", "HEAD"),
      await f.git(f.remote, "rev-parse", "refs/heads/main"),
    );
    for (const path of [".env", "draft.txt", "unpublished.txt"])
      await assert.rejects(readFile(join(project.path, path)));
    assert.equal(await realpath(f.source), project.path);
    assert.equal((await lstat(f.source)).isSymbolicLink(), true);
    assert.equal((await f.projects.views())[0]?.git?.branch, "main");
    assert.deepEqual(await readdir(f.local), ["project"]);
  } finally {
    await f.close();
  }
});

test("unreadable HEAD uses the sole origin tracking branch and can recover in place", async () => {
  const f = await recoveryFixture();
  try {
    const target = join(f.local, "project");
    await rename(f.source, target);
    await writeFile(join(target, ".git", "HEAD"), "broken HEAD\n");
    const inspection = await f.projects.inspect(target);
    assert.equal(inspection.recovery?.remote, f.url);
    assert.equal(inspection.recovery?.branch, "main");
    const { project } = await f.recover(target);
    assert.equal(project.path, target);
    assert.equal((await f.projects.views())[0]?.git?.hasCommit, true);
    assert.equal(await realpath(f.source), target);
    assert.deepEqual(await readdir(f.local), ["project"]);
  } finally {
    await f.close();
  }
});

test("failed recovery clone leaves original files, unreadable metadata and project list unchanged", async () => {
  const f = await recoveryFixture();
  try {
    await writeFile(join(f.source, ".git", "index"), "");
    await writeFile(join(f.source, ".env"), "original private file");
    const execute: Run = (command, args, options) => {
      if (command === "git" && args[0] === "clone")
        throw new Error("fixture authentication failed");
      return f.execute(command, args, options);
    };
    const projects = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      execute,
    );
    await assert.rejects(
      projects.create({
        mode: "import",
        name: "project",
        source: f.source,
        repository: f.url,
        visibility: "private",
        useRemote: true,
        createRepository: false,
        recovery: { confirmed: true, branch: "main" },
      }),
      /Original folder unchanged.*authentication failed/,
    );
    assert.equal(
      await readFile(join(f.source, ".env"), "utf8"),
      "original private file",
    );
    assert.equal(await readFile(join(f.source, ".git", "index"), "utf8"), "");
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
    assert.deepEqual(await projects.views(), []);
    assert.deepEqual(await readdir(f.local), []);
  } finally {
    await f.close();
  }
});

test("failed recovery registration rolls back the original folder and removes the new link", async () => {
  const f = await recoveryFixture();
  try {
    await writeFile(join(f.source, ".git", "index"), "");
    await writeFile(join(f.source, ".env"), "retain on rollback");
    const registry = join(f.root, "state", "projects.json");
    const execute: Run = async (command, args, options) => {
      const result = await f.execute(command, args, options);
      if (command === "git" && args[0] === "clone") await mkdir(registry);
      return result;
    };
    const projects = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      execute,
    );
    await assert.rejects(
      projects.create({
        mode: "import",
        name: "project",
        source: f.source,
        repository: f.url,
        visibility: "private",
        useRemote: true,
        createRepository: false,
        recovery: { confirmed: true, branch: "main" },
      }),
      /Original folder restored/,
    );
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
    assert.equal(
      await readFile(join(f.source, ".env"), "utf8"),
      "retain on rollback",
    );
    assert.equal(await readFile(join(f.source, ".git", "index"), "utf8"), "");
    assert.deepEqual(await readdir(f.local), []);
    await rm(registry, { recursive: true });
    assert.deepEqual(await projects.views(), []);
  } finally {
    await f.close();
  }
});

test("explicit recovery refuses healthy repositories, linked worktrees and unrelated destinations", async () => {
  const f = await recoveryFixture();
  try {
    await assert.rejects(f.recover(), /unreadable imported repository/);
    await f.git(
      f.source,
      "worktree",
      "add",
      "-b",
      "linked",
      join(f.cloud, "linked"),
    );
    await rm(join(f.cloud, "linked", ".git"));
    await writeFile(join(f.cloud, "linked", ".git"), "broken worktree\n");
    await assert.rejects(
      f.recover(join(f.cloud, "linked")),
      /Linked Git worktrees/,
    );
    await writeFile(join(f.source, ".git", "index"), "");
    await mkdir(join(f.local, "project"));
    await writeFile(join(f.local, "project", "sentinel"), "unrelated");
    await assert.rejects(f.recover(), /destination already exists/);
    assert.equal(
      await readFile(join(f.local, "project", "sentinel"), "utf8"),
      "unrelated",
    );
    assert.equal((await lstat(f.source)).isSymbolicLink(), false);
  } finally {
    await f.close();
  }
});

test("recovery without a branch uses the committed remote default", async () => {
  const f = await recoveryFixture();
  try {
    await f.git(f.remote, "symbolic-ref", "HEAD", "refs/heads/main");
    await writeFile(join(f.source, ".git", "index"), "");
    const { project } = await f.projects.create({
      mode: "import",
      name: "project",
      source: f.source,
      repository: f.url,
      visibility: "private",
      useRemote: true,
      createRepository: false,
      recovery: { confirmed: true },
    });
    assert.equal(
      await f.git(project.path, "rev-parse", "HEAD"),
      await f.git(f.remote, "rev-parse", "HEAD"),
    );
  } finally {
    await f.close();
  }
});

test("recovery keeps a valid pre-existing folder link during registration rollback", async () => {
  const f = await recoveryFixture();
  try {
    const target = join(f.local, "project");
    await rename(f.source, target);
    await symlink(
      target,
      f.source,
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(target, ".git", "index"), "");
    const registry = join(f.root, "state", "projects.json");
    const execute: Run = async (command, args, options) => {
      const result = await f.execute(command, args, options);
      if (command === "git" && args[0] === "clone") await mkdir(registry);
      return result;
    };
    const projects = new Projects(
      join(f.root, "state"),
      f.settings,
      [f.cloud],
      execute,
    );
    await assert.rejects(
      projects.create({
        mode: "import",
        name: "project",
        source: target,
        repository: f.url,
        visibility: "private",
        useRemote: true,
        createRepository: false,
        recovery: { confirmed: true, branch: "main" },
      }),
      /Original folder restored/,
    );
    assert.equal(await realpath(f.source), target);
    assert.equal(await readFile(join(target, ".git", "index"), "utf8"), "");
    assert.deepEqual(await readdir(f.local), ["project"]);
  } finally {
    await f.close();
  }
});

test("a link collision after cloning keeps the recovered project registered and exposes repair", async () => {
  const f = await recoveryFixture();
  try {
    const settings = { ...f.settings, linksFolder: join(f.cloud, "links") };
    const link = join(settings.linksFolder, "project");
    await writeFile(join(f.source, ".git", "index"), "");
    const execute: Run = async (command, args, options) => {
      const result = await f.execute(command, args, options);
      if (command === "git" && args[0] === "clone")
        await mkdir(link, { recursive: true });
      return result;
    };
    const projects = new Projects(
      join(f.root, "state"),
      settings,
      [f.cloud],
      execute,
    );
    const result = await projects.create({
      mode: "import",
      name: "project",
      source: f.source,
      repository: f.url,
      visibility: "private",
      useRemote: true,
      createRepository: false,
      recovery: { confirmed: true, branch: "main" },
    });
    assert.match(result.warning ?? "", /Folder link failed/);
    assert.equal((await projects.views())[0]?.linkMissing, true);
    assert.deepEqual(await readdir(f.local), ["project"]);
    await rm(link, { recursive: true });
    await projects.repairLink(result.project.id);
    assert.equal(await realpath(link), result.project.path);
  } finally {
    await f.close();
  }
});
