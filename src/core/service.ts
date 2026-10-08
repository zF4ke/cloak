import { homedir } from "node:os";
import { join } from "node:path";
import { Projects } from "./projects.ts";
import { Protection } from "./protection.ts";
import { FolderUnlocker } from "./folder-locks.ts";
import { run as execute, type Run } from "./commands.ts";
import { folderPickerPath } from "./folder-picker.ts";
import type { CloakApi, Snapshot, Settings } from "../shared/types.ts";

export class Service {
  readonly projects: Projects;
  readonly protection: Protection;
  readonly unlocker: FolderUnlocker;
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  constructor(
    readonly directory: string,
    readonly scripts: string,
    readonly desktop: boolean,
    private run: Run = execute,
    private hooks: {
      openPath?: (path: string) => Promise<void>;
      openUrl?: (url: string) => Promise<void>;
      chooseFolder?: (
        defaultPath: string | undefined,
      ) => Promise<string | undefined>;
      login?: (enabled: boolean) => void;
    } = {},
  ) {
    const cloud = [
      ...new Set(
        [
          process.env.OneDrive,
          process.env.OneDriveConsumer,
          process.env.OneDriveCommercial,
          join(homedir(), "OneDrive"),
        ].filter((root): root is string => Boolean(root)),
      ),
    ];
    const defaults: Settings = {
      projectsFolder: join(homedir(), "Projects"),
      linksFolder: join(cloud[0]!, "Projects"),
      createLinks: true,
      autoPull: true,
      pollMinutes: 5,
      launchAtLogin: false,
      behindEdits: "discard",
    };
    this.projects = new Projects(directory, defaults, cloud, run, scripts);
    this.unlocker = new FolderUnlocker(scripts, run);
    this.protection = new Protection(scripts, directory, run, desktop);
  }
  async initialize() {
    await this.projects.initialize();
    if (this.desktop) await this.protection.refresh();
    if (this.desktop) await this.projects.cleanupRecoveries();
    if (this.desktop) await this.projects.migrateShortcuts();
    // Reuse an existing configured Projects folder for links on first setup.
    const settings = this.projects.settings();
    const config = await this.protection.config();
    if (
      settings.linksFolder ===
        join(process.env.OneDrive || join(homedir(), "OneDrive"), "Projects") &&
      config.watchRoots[0]
    ) {
      const { exists } = await import("./paths.ts");
      if (await exists(config.watchRoots[0]))
        await this.projects.saveSettings({
          ...settings,
          linksFolder: config.watchRoots[0],
        });
    }
    this.schedule();
  }
  private check() {
    if (!this.checking)
      this.checking = this.projects
        .cleanupRecoveries()
        .then(() =>
          this.projects.settings().autoPull
            ? this.projects.checkUpdates()
            : undefined,
        )
        .finally(() => {
          this.checking = undefined;
        });
    return this.checking;
  }
  private schedule() {
    if (this.timer) clearInterval(this.timer);
    const settings = this.projects.settings();
    if (this.desktop) {
      void this.check().catch(() => {});
      this.timer = setInterval(() => {
        void this.check().catch(() => {});
      }, settings.pollMinutes * 60_000);
      this.timer.unref();
    }
  }
  close() {
    if (this.timer) clearInterval(this.timer);
  }
  async snapshot(): Promise<Snapshot> {
    const [projects, protection, config, gitAvailable, github] =
      await Promise.all([
        this.projects.views(),
        this.protection.state(),
        this.protection.config(),
        this.run("git", ["--version"]).then(
          () => true,
          () => false,
        ),
        this.run("gh", ["auth", "status", "--active", "--json", "hosts"]).then(
          (raw) => {
            const hosts = JSON.parse(raw).hosts as Record<
              string,
              { login: string; active: boolean; state: string }[]
            >;
            const account = hosts["github.com"]?.find(
              (account) => account.active && account.state === "success",
            );
            return {
              available: true,
              login: account?.login,
              ...(account ? {} : { error: "Sign in with gh auth login." }),
            };
          },
          () => ({
            available: false,
            error: "Install GitHub CLI and run gh auth login.",
          }),
        ),
      ]);
    return {
      recoveryWarnings: [...this.projects.recoveryWarnings],
      settings: this.projects.settings(),
      projects,
      protection,
      config,
      gitAvailable,
      github,
      desktop: this.desktop,
    };
  }
  async call(method: keyof CloakApi, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "folderLocks":
        return this.unlocker.inspect(args[0] as string);
      case "closeFolderLocks":
        return this.unlocker.close(args[0] as string, args[1] as boolean);
      case "openUnlockHelp":
        return this.hooks.openUrl?.(
          "https://learn.microsoft.com/en-us/windows/powertoys/install",
        );
      case "snapshot":
        return this.snapshot();
      case "inspect":
        return this.projects.inspect(args[0] as string);
      case "create":
        return this.projects.create(
          args[0] as Parameters<CloakApi["create"]>[0],
        );
      case "sync":
        return this.projects.sync(
          args[0] as string,
          args[1] as Parameters<CloakApi["sync"]>[1],
        );
      case "checkUpdates":
        return this.projects.checkUpdates(true);
      case "connectRepository":
        return this.projects.connectRepository(
          args[0] as string,
          args[1] as string,
          args[2] as boolean,
          args[3] as "private" | "public",
        );
      case "saveSettings": {
        const settings = args[0] as Settings;
        await this.projects.saveSettings(settings);
        this.hooks.login?.(settings.launchAtLogin);
        this.schedule();
        return;
      }
      case "saveProtection":
        return this.protection.save(
          args[0] as Parameters<CloakApi["saveProtection"]>[0],
        );
      case "protectionAction": {
        if (args[0] === "install")
          await this.protection.save(await this.protection.config());
        return this.protection.action(
          args[0] as string,
          args[1] as string | undefined,
        );
      }
      case "repairLink":
        return this.projects.repairLink(args[0] as string);
      case "changeFolder":
        return this.projects.changeFolder(args[0] as string, args[1] as string);
      case "forget":
        return this.projects.forget(args[0] as string);
      case "openProject":
        return this.hooks.openPath?.(
          this.projects.project(args[0] as string).path,
        );
      case "openRepository": {
        const { browserRepository } = await import("./git.ts");
        const project = this.projects.project(args[0] as string);
        const state = await import("./git.ts").then(({ gitState }) =>
          gitState(project.path, this.run),
        );
        if (!state.remote) throw new Error("No repository is connected.");
        return this.hooks.openUrl?.(browserRepository(state.remote));
      }
      case "chooseFolder": {
        const options = args[0] as Parameters<CloakApi["chooseFolder"]>[0];
        if (
          options !== undefined &&
          (!options ||
            typeof options !== "object" ||
            Array.isArray(options) ||
            (options.path !== undefined && typeof options.path !== "string") ||
            (options.location !== undefined &&
              !["projects", "onedrive"].includes(options.location)))
        )
          throw new Error("Invalid folder picker options.");
        const settings = this.projects.settings();
        const fallback =
          options?.location === "onedrive"
            ? settings.linksFolder
            : settings.projectsFolder;
        return this.hooks.chooseFolder?.(
          await folderPickerPath(options?.path, fallback),
        );
      }
      default:
        throw new Error("Unknown command.");
    }
  }
}
