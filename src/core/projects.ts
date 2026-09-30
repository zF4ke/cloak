import {
  mkdir,
  readFile,
  rename,
  unlink,
  realpath,
  lstat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { JsonStore } from "./storage.ts";
import { withProjectLock } from "./lock.ts";
import {
  exists,
  inside,
  projectName,
  resolvedPath,
  moveProjectFolder,
} from "./paths.ts";
import { gitState, githubUrl } from "./git.ts";
import { replaceFromRemote } from "./recovery.ts";
import { cleanupRecoveries } from "./recovery-cleanup.ts";
import { createShortcut, shortcutMatches, shortcutPath } from "./shortcuts.ts";
import type { Run } from "./commands.ts";
import type {
  Inspection,
  ManagedProject,
  ProjectPlan,
  ProjectView,
  Settings,
} from "../shared/types.ts";

type State = { version: 1; settings: Settings; projects: ManagedProject[] };
const ignore =
  "# Dependencies and build output\nnode_modules/\ndist/\nbuild/\n.venv/\n__pycache__/\n# Local credentials and runtime data\n.env\n.env.*\n!.env.example\n*.log\n*.sqlite\n*.sqlite-wal\n*.sqlite-shm\n";

/** Owns managed folder identities, Git operations and folder-link creation. */
export class Projects {
  private state!: State;
  private writes = Promise.resolve();
  private updates = new Map<string, { checkedAt: string; message?: string }>();
  recoveryWarnings: string[] = [];
  private store: JsonStore<State>;
  constructor(
    private directory: string,
    private defaults: Settings,
    private cloudRoots: string[],
    private run: Run,
    private scripts = process.cwd(),
  ) {
    this.store = new JsonStore(directory, "projects.json");
  }
  async initialize() {
    this.state = await this.store.read(() => ({
      version: 1,
      settings: this.defaults,
      projects: [],
    }));
    if (
      this.state.version !== 1 ||
      !Array.isArray(this.state.projects) ||
      !this.state.settings ||
      this.state.projects.some((p) => !p.id || !p.path || !p.name)
    )
      throw new Error("Cloak project list is invalid. Repair projects.json.");
    this.state.settings = { ...this.defaults, ...this.state.settings };
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(() =>
      withProjectLock(this.directory, async () => {
        await this.initialize();
        return operation();
      }),
    );
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  settings() {
    return structuredClone(this.state.settings);
  }
  async cleanupRecoveries() {
    return this.serial(async () => {
      await this.validateSettings(this.state.settings);
      this.recoveryWarnings = await cleanupRecoveries(
        this.state.settings.projectsFolder,
        this.state.projects.map((p) => p.path),
      );
    }).catch((error) => {
      this.recoveryWarnings = [
        `Recovery cleanup pending: ${error instanceof Error ? error.message : String(error)}`,
      ];
    });
  }
  async saveSettings(settings: Settings) {
    return this.serial(async () => {
      await this.validateSettings(settings);
      const next = { ...this.state, settings: structuredClone(settings) };
      await this.store.write(next);
      this.state = next;
    });
  }
  private async cloud(path: string) {
    for (const root of this.cloudRoots)
      if (inside(await resolvedPath(root), path)) return true;
    return false;
  }
  private async validateSettings(settings: Settings) {
    const root = await resolvedPath(settings.projectsFolder);
    if (await this.cloud(root))
      throw new Error("Choose a project folder outside OneDrive.");
    if (
      !settings.linksFolder ||
      !["discard", "keep"].includes(settings.behindEdits) ||
      !Number.isInteger(settings.pollMinutes) ||
      settings.pollMinutes < 1 ||
      settings.pollMinutes > 1440 ||
      ["createLinks", "autoPull", "launchAtLogin"].some(
        (key) => typeof settings[key as keyof Settings] !== "boolean",
      )
    )
      throw new Error("Check the folder and update settings.");
    const links = await resolvedPath(settings.linksFolder);
    if (settings.createLinks && inside(root, links))
      throw new Error("Shortcuts must be outside the real project folder.");
  }
  async inspect(path: string): Promise<Inspection> {
    const actual = await realpath(path);
    const stat = await lstat(actual);
    if (!stat.isDirectory()) throw new Error("Choose a project folder.");
    let git: Inspection["git"], recovery: Inspection["recovery"];
    const top = await this.run("git", [
      "-C",
      actual,
      "rev-parse",
      "--show-toplevel",
    ]).catch(() => undefined);
    const hasGit = await exists(join(actual, ".git"));
    if (!top && hasGit)
      recovery = { error: "Git cannot read this repository's metadata." };
    if (top) {
      if (resolve(await realpath(top)) !== resolve(actual))
        throw new Error(
          "Choose the Git repository root, not a folder inside it.",
        );
      try {
        git = await gitState(actual, this.run);
      } catch (error) {
        recovery = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (recovery) {
      const config = (key: string) =>
        this.run("git", [
          "config",
          "--file",
          join(actual, ".git", "config"),
          "--get",
          key,
        ]).catch(() => undefined);
      recovery.remote = await config("remote.origin.url");
      let branch = await this.run("git", [
        "-C",
        actual,
        "symbolic-ref",
        "--short",
        "HEAD",
      ]).catch(() => undefined);
      if (!branch) {
        const entries = await this.run("git", [
          "config",
          "--file",
          join(actual, ".git", "config"),
          "--get-regexp",
          "^branch\\..*\\.remote$",
        ]).catch(() => "");
        const candidates = entries
          .split(/\r?\n/)
          .map((entry) => /^branch\.(.+)\.remote\s+origin$/.exec(entry))
          .filter((entry) => entry !== null);
        if (candidates.length === 1) branch = candidates[0]![1];
      }
      if (branch && (await config(`branch.${branch}.remote`)) === "origin") {
        const merge = await config(`branch.${branch}.merge`);
        if (merge?.startsWith("refs/heads/")) recovery.branch = merge.slice(11);
      }
    }
    const worktree = await lstat(join(actual, ".git")).then(
      (stat) => stat.isFile(),
      () => false,
    );
    return {
      path: actual,
      name: basename(actual),
      git,
      inOneDrive: await this.cloud(actual),
      worktree,
      recovery,
    };
  }
  async views(): Promise<ProjectView[]> {
    await this.writes;
    await this.initialize();
    return Promise.all(
      this.state.projects.map(async (project) => {
        try {
          return {
            ...project,
            git: await gitState(project.path, this.run),
            linkMissing: Boolean(
              project.link &&
              !(await shortcutMatches(
                project.link,
                project.path,
                this.scripts,
                this.run,
              )),
            ),
            update: this.updates.get(project.id),
          };
        } catch (error) {
          return {
            ...project,
            error: error instanceof Error ? error.message : String(error),
            update: this.updates.get(project.id),
          };
        }
      }),
    );
  }
  project(id: string) {
    const project = this.state.projects.find((p) => p.id === id);
    if (!project) throw new Error("Project not found.");
    return structuredClone(project);
  }
  async migrateShortcuts() {
    await this.initialize();
    if (!this.state.settings.createLinks) return;
    for (const project of this.state.projects) {
      if (
        project.legacyLink ||
        (project.link && !project.link.toLowerCase().endsWith(".lnk"))
      ) {
        try {
          await this.repairLink(project.id);
        } catch (error) {
          this.recoveryWarnings.push(
            `Shortcut conversion pending for ${project.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  private async link(
    project: ManagedProject,
    onCreated?: (link: string) => Promise<void>,
  ) {
    if (!this.state.settings.createLinks) return undefined;
    const folder = resolve(this.state.settings.linksFolder),
      link = shortcutPath(folder, project.name);
    await mkdir(folder, { recursive: true });
    if (await exists(link)) {
      if (await shortcutMatches(link, project.path, this.scripts, this.run))
        return link;
      throw new Error(`The shortcut path is already occupied: ${link}`);
    }
    await createShortcut(link, project.path, this.scripts, this.run);
    await onCreated?.(link);
    return link;
  }
  async create(plan: ProjectPlan) {
    return this.serial(async () => {
      const settings = this.settings();
      await this.validateSettings(settings);
      const name = projectName(plan.name),
        root = await resolvedPath(settings.projectsFolder),
        target = join(root, name);
      if (
        !["new", "import", "clone"].includes(plan.mode) ||
        !["private", "public"].includes(plan.visibility) ||
        typeof plan.createRepository !== "boolean" ||
        typeof plan.useRemote !== "boolean"
      )
        throw new Error("Invalid project setup.");
      let inspection: Inspection | undefined;
      if (plan.mode === "import") {
        if (!plan.source)
          throw new Error("Choose the existing project folder.");
        inspection = await this.inspect(plan.source);
        if (inspection.recovery && !plan.recovery)
          throw new Error(
            "Git cannot read this repository. Choose Use latest remote version to replace it, or repair Git before importing.",
          );
        if (inspection.worktree && resolve(inspection.path) !== resolve(target))
          throw new Error(
            "Linked Git worktrees cannot be moved. Keep their current folder.",
          );
      }
      if (
        plan.recovery &&
        (plan.mode !== "import" ||
          !inspection?.recovery ||
          plan.recovery.confirmed !== true)
      )
        throw new Error(
          "Recovery requires an unreadable imported repository and explicit confirmation.",
        );
      if (plan.recovery && inspection?.worktree)
        throw new Error(
          "Linked Git worktrees cannot be replaced. Repair them in Git.",
        );
      if (this.state.projects.some((p) => resolve(p.path) === resolve(target)))
        throw new Error("This project is already managed by Cloak.");
      if (
        (await exists(target)) &&
        (!inspection || resolve(inspection.path) !== resolve(target))
      )
        throw new Error(`The destination already exists: ${target}`);
      if (
        inspection &&
        (inside(inspection.path, target) || inside(target, inspection.path)) &&
        resolve(inspection.path) !== resolve(target)
      )
        throw new Error(
          "Source and destination folders must not contain each other.",
        );
      if (settings.createLinks) {
        const link = shortcutPath(settings.linksFolder, name);
        if (resolve(link) === resolve(target))
          throw new Error(
            "The shortcut must be separate from the real folder.",
          );
        if (
          (await exists(link)) &&
          (!inspection || resolve(link) !== resolve(inspection.path))
        ) {
          if (!(await shortcutMatches(link, target, this.scripts, this.run)))
            throw new Error(
              `The shortcuts folder already contains ${name}.lnk.`,
            );
        }
      }
      const cloneUrl =
        plan.mode === "clone" || plan.recovery
          ? githubUrl(plan.repository ?? "")
          : undefined;
      if (plan.recovery) {
        if (plan.createRepository || !plan.useRemote)
          throw new Error("Recovery uses an existing remote repository.");
        const source = inspection!.path;
        if (
          this.state.projects.some(
            (project) => resolve(project.path) === resolve(source),
          )
        )
          throw new Error(
            "This source is already managed by Cloak. Remove its list entry before importing it again.",
          );
        return replaceFromRemote(
          {
            source,
            target,
            root,
            remote: cloneUrl!,
            cloudMove: inspection!.inOneDrive
              ? {
                  scripts: this.scripts,
                  directory: this.directory,
                  run: this.run,
                }
              : undefined,
            branch: plan.recovery.branch,
          },
          this.run,
          async () => {
            const current = await this.inspect(source);
            if (!current.recovery || current.worktree)
              throw new Error(
                "The source repository changed. Inspect it again before recovery.",
              );
          },
          async (onLinkCreated) => {
            const project: ManagedProject = {
              id: randomUUID(),
              name,
              path: target,
              remote: cloneUrl!,
              addedAt: new Date().toISOString(),
              link: settings.createLinks
                ? shortcutPath(settings.linksFolder, name)
                : undefined,
            };
            let warning: string | undefined;
            try {
              project.link = await this.link(project, onLinkCreated);
            } catch (error) {
              warning = `Project recovered. Shortcut failed: ${error instanceof Error ? error.message : String(error)}`;
            }
            const next = {
              ...this.state,
              projects: [...this.state.projects, project],
            };
            await this.store.write(next);
            this.state = next;
            return { project, warning };
          },
        );
      }
      if (
        plan.mode !== "clone" &&
        !plan.createRepository &&
        !(inspection?.git?.remote && plan.useRemote)
      )
        throw new Error(
          "Confirm the existing repository or create a GitHub repository.",
        );
      if (plan.createRepository && inspection?.git?.remote)
        throw new Error(
          "This project already has an origin remote. Use its existing repository.",
        );
      if (
        plan.createRepository &&
        !/^[A-Za-z0-9_.-]+$/.test(plan.repository ?? name)
      )
        throw new Error(
          "Use letters, numbers, dots, hyphens or underscores for the repository name.",
        );
      if (plan.createRepository) await this.run("gh", ["auth", "status"]);
      await mkdir(root, { recursive: true });
      if (inspection && resolve(inspection.path) !== resolve(target)) {
        try {
          await moveProjectFolder(
            inspection.path,
            target,
            inspection.inOneDrive
              ? {
                  scripts: this.scripts,
                  directory: this.directory,
                  run: this.run,
                }
              : undefined,
          );
        } catch (error) {
          throw new Error(
            `Original folder unchanged. ${error instanceof Error ? error.message : "Could not move the folder."}`,
          );
        }
      } else if (plan.mode === "clone")
        await this.run("git", ["clone", "--", cloneUrl!, target], {
          timeout: 180_000,
        });
      else if (!inspection) {
        await mkdir(target);
        await writeFile(join(target, ".gitignore"), ignore, { flag: "wx" });
        await writeFile(join(target, "README.md"), `# ${name}\n`, {
          flag: "wx",
        });
      }
      let warning: string | undefined;
      try {
        if (!inspection?.git && plan.mode !== "clone") {
          await this.run("git", ["-C", target, "init", "-b", "main"]);
          if (!(await exists(join(target, ".gitignore"))))
            await writeFile(join(target, ".gitignore"), ignore, { flag: "wx" });
        }
        if (plan.createRepository)
          await this.run(
            "gh",
            [
              "repo",
              "create",
              plan.repository || name,
              `--${plan.visibility}`,
              "--source",
              target,
              "--remote",
              "origin",
            ],
            { timeout: 90_000 },
          );
      } catch (error) {
        warning = `Folder kept at ${target}. ${error instanceof Error ? error.message : String(error)}`;
      }
      const project: ManagedProject = {
        id: randomUUID(),
        name,
        path: target,
        remote: (await gitState(target, this.run).catch(() => undefined))
          ?.remote,
        addedAt: new Date().toISOString(),
        link: settings.createLinks
          ? shortcutPath(settings.linksFolder, name)
          : undefined,
      };
      try {
        project.link = await this.link(project);
      } catch (error) {
        warning = [
          warning,
          `Project added. Shortcut failed: ${error instanceof Error ? error.message : String(error)}`,
        ]
          .filter(Boolean)
          .join(" ");
      }
      const next = {
        ...this.state,
        projects: [...this.state.projects, project],
      };
      await this.store.write(next);
      this.state = next;
      return { project, warning };
    });
  }
  async repairLink(id: string) {
    return this.serial(async () => {
      const project = this.project(id);
      await this.validateSettings(this.state.settings);
      if (!this.state.settings.createLinks)
        throw new Error("Enable project shortcuts in Settings first.");
      const previousLink = project.legacyLink ?? project.link;
      const previousStat =
        previousLink && !previousLink.toLowerCase().endsWith(".lnk")
          ? await lstat(previousLink, { bigint: true }).catch((error) => {
              if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
              throw error;
            })
          : undefined;
      const ownedJunction =
        previousStat?.isSymbolicLink() &&
        resolve(await realpath(previousLink!)) === resolve(project.path);
      if (previousStat && !ownedJunction)
        throw new Error("The old folder link changed. It was not removed.");
      if (ownedJunction) project.legacyLink = previousLink;
      project.link = await this.link(project);
      const next = {
        ...this.state,
        projects: this.state.projects.map((p) => (p.id === id ? project : p)),
      };
      await this.store.write(next);
      this.state = next;
      // Convert only the recorded, verified junction, after registering its replacement.
      if (ownedJunction) {
        const current = await lstat(previousLink!, { bigint: true });
        if (
          current.isSymbolicLink() &&
          current.dev === previousStat!.dev &&
          current.ino === previousStat!.ino &&
          resolve(await realpath(previousLink!)) === resolve(project.path)
        )
          await unlink(previousLink!);
        else
          throw new Error("The old folder link changed. It was not removed.");
      }
      if (project.legacyLink) {
        delete project.legacyLink;
        await this.store.write(next);
      }
    });
  }
  async forget(id: string) {
    return this.serial(async () => {
      this.project(id);
      const next = {
        ...this.state,
        projects: this.state.projects.filter((p) => p.id !== id),
      };
      await this.store.write(next);
      this.state = next;
    });
  }
  async connectRepository(
    id: string,
    repository: string,
    create: boolean,
    visibility: "private" | "public",
  ) {
    return this.serial(async () => {
      const project = this.project(id),
        state = await gitState(project.path, this.run);
      if (state.remote)
        throw new Error("This project already has an origin repository.");
      if (
        !["private", "public"].includes(visibility) ||
        typeof create !== "boolean"
      )
        throw new Error("Invalid repository setup.");
      if (create) {
        if (!/^[A-Za-z0-9_.-]+$/.test(repository))
          throw new Error(
            "Use letters, numbers, dots, hyphens or underscores for the repository name.",
          );
        await this.run("gh", ["auth", "status"]);
        await this.run(
          "gh",
          [
            "repo",
            "create",
            repository,
            `--${visibility}`,
            "--source",
            project.path,
            "--remote",
            "origin",
          ],
          { timeout: 90_000 },
        );
      } else
        await this.run("git", [
          "-C",
          project.path,
          "remote",
          "add",
          "origin",
          githubUrl(repository),
        ]);
    });
  }
  async sync(id: string, commit?: { message: string; files: string[] }) {
    return this.serial(async () => {
      const project = this.project(id);
      let state = await gitState(project.path, this.run);
      const git = (...args: string[]) =>
        this.run("git", ["-C", project.path, ...args], { timeout: 90_000 });
      if (!state.remote)
        throw new Error("Add a GitHub origin remote to this project first.");
      if (state.branch === "Detached HEAD")
        throw new Error("Switch to a branch before syncing.");
      if (commit) {
        if (
          !commit.message?.trim() ||
          !Array.isArray(commit.files) ||
          !commit.files.length ||
          commit.files.some(
            (path) => !state.changes.some((change) => change.path === path),
          )
        )
          throw new Error("Choose changed files and write a commit message.");
        const staged = await git("diff", "--cached", "--name-only", "-z");
        if (
          staged
            .split("\0")
            .filter(Boolean)
            .some((path) => !commit.files.includes(path))
        )
          throw new Error(
            "Other files are already staged. Include them in this commit or unstage them in Git.",
          );
        await this.run("git", [
          "--literal-pathspecs",
          "-C",
          project.path,
          "add",
          "--",
          ...commit.files,
        ]);
        await git("commit", "-m", commit.message.trim());
        state = await gitState(project.path, this.run);
      }
      if (state.changes.length)
        throw new Error(
          "Commit or set aside local changes before syncing. Cloak will not overwrite them.",
        );
      if (!state.hasCommit)
        throw new Error("Make a first commit before syncing.");
      await this.pull(project, false);
      const upstream = await git(
        "rev-parse",
        "--symbolic-full-name",
        "@{upstream}",
      ).catch(() => undefined);
      const destination = upstream?.startsWith("refs/remotes/origin/")
        ? upstream.slice("refs/remotes/origin/".length)
        : state.branch;
      await git("push", "-u", "origin", `HEAD:refs/heads/${destination}`);
      this.updates.set(id, { checkedAt: new Date().toISOString() });
    });
  }
  private async pull(project: ManagedProject, automatic: boolean) {
    const git = (...args: string[]) =>
      this.run("git", ["-C", project.path, ...args], { timeout: 90_000 });
    let state = await gitState(project.path, this.run);
    if (!state.remote) throw new Error("No origin repository.");
    if (state.branch === "Detached HEAD")
      throw new Error("Switch to a branch to get updates.");
    const observedHead = state.hasCommit
      ? await git("rev-parse", "HEAD")
      : undefined;
    await git("fetch", "origin");
    const upstream = await git(
      "rev-parse",
      "--symbolic-full-name",
      "@{upstream}",
    ).catch(() => undefined);
    if (upstream && !upstream.startsWith("refs/remotes/origin/"))
      throw new Error("This branch tracks another remote. Sync it in Git.");
    const remote = upstream || `refs/remotes/origin/${state.branch}`;
    if (
      !(await git("rev-parse", "--verify", remote).then(
        () => true,
        () => false,
      ))
    )
      return;
    if (!state.hasCommit) {
      if (automatic)
        throw new Error("No local commit. Finish setting up this project.");
      return;
    }
    const [ahead = 0, behind = 0] = (
      await git("rev-list", "--left-right", "--count", `HEAD...${remote}`)
    )
      .split(/\s+/)
      .map(Number);
    if (ahead && behind)
      throw new Error(
        "Local and remote commits differ. Resolve them in Git before syncing.",
      );
    if (automatic && ahead) return;
    if (behind) {
      if (
        (await git("rev-parse", "HEAD")) !== observedHead ||
        (await git("symbolic-ref", "--short", "HEAD")) !== state.branch
      )
        throw new Error("Project changed while checking updates. Try again.");
      // Re-read dirty state after fetch. Editors and Git clients can change it meanwhile.
      state = await gitState(project.path, this.run);
      if (automatic && this.state.settings.behindEdits === "discard") {
        const ignored = (
          await git(
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
            "-z",
          )
        )
          .split("\0")
          .filter(Boolean)
          .map((path) => path.replace(/\/$/, ""))
          .map((path) =>
            process.platform === "win32" ? path.toLowerCase() : path,
          );
        const incoming = (
          await git("ls-tree", "-r", "--name-only", "-z", remote)
        )
          .split("\0")
          .filter(Boolean)
          .map((path) =>
            process.platform === "win32" ? path.toLowerCase() : path,
          );
        if (
          ignored.some((local) =>
            incoming.some(
              (path) =>
                path === local ||
                path.startsWith(`${local}/`) ||
                local.startsWith(`${path}/`),
            ),
          )
        )
          throw new Error(
            "An incoming tracked path conflicts with ignored local files. Move those files aside before updating.",
          );
        // Use the current ignore rules for cleanup. Incoming .gitignore changes
        // must not make previously ignored files eligible for deletion.
        await git("clean", "-fd");
        await git("reset", "--hard", remote);
      } else {
        if (state.changes.length)
          throw new Error(
            "New commits are available, but local edits need attention.",
          );
        await git("merge", "--ff-only", remote);
      }
    }
    // Establish tracking after an imported repository's first successful pull.
    if (
      !(await git("rev-parse", "--abbrev-ref", "@{upstream}").then(
        () => true,
        () => false,
      ))
    )
      await git("branch", "--set-upstream-to", `origin/${state.branch}`);
  }
  async checkUpdates(force = false) {
    if (!force && !this.state.settings.autoPull) return;
    return this.serial(async () => {
      for (const project of this.state.projects) {
        try {
          await this.pull(project, true);
          this.updates.set(project.id, { checkedAt: new Date().toISOString() });
        } catch (error) {
          this.updates.set(project.id, {
            checkedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  }
}
