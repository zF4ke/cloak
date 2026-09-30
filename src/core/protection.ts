import { join } from "node:path";
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  lstat,
  realpath,
} from "node:fs/promises";
import { resolve } from "node:path";
import { parse, type ParseError } from "jsonc-parser/lib/esm/main.js";
import type { Run } from "./commands.ts";
import type { ProtectionConfig, ProtectionState } from "../shared/types.ts";
import { randomUUID } from "node:crypto";
import { withProjectLock } from "./lock.ts";
export class Protection {
  constructor(
    private scripts: string,
    private directory: string,
    private run: Run,
    private desktop: boolean,
  ) {}
  async refresh() {
    if (process.platform !== "win32") return;
    return withProjectLock(this.directory, () => this.refreshLocked());
  }
  private async refreshLocked() {
    const deployed = await readFile(join(this.directory, "cloakd.ps1")).catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      },
    );
    if (
      !deployed ||
      deployed.equals(await readFile(join(this.scripts, "cloakd.ps1")))
    )
      return;
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      resolve(await realpath(this.directory)) !== resolve(this.directory)
    )
      throw new Error("Protection folder is redirected.");
    await this.run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(this.scripts, "refresh-protection.ps1"),
        "-StateDir",
        this.directory,
      ],
      { timeout: 30_000 },
    );
  }
  async config(): Promise<ProtectionConfig> {
    const deployed = join(this.directory, "config.jsonc");
    let text: string;
    try {
      text = await readFile(deployed, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      text = await readFile(join(this.scripts, "config.jsonc"), "utf8");
    }
    const errors: ParseError[] = [];
    const value = parse(text.replace(/^\uFEFF/, ""), errors);
    if (errors.length || !value || !Array.isArray(value.watchRoots))
      throw new Error("Cloak configuration is invalid. Repair config.jsonc.");
    return {
      ...value,
      scratchDir: value.scratchDir || join(this.directory, "scratch"),
      settleMaxMinutes: value.settleMaxMinutes ?? 30,
    };
  }
  async state(): Promise<ProtectionState> {
    try {
      const raw = await this.run("powershell.exe", [
        "-NoProfile",
        "-File",
        join(this.scripts, "desktop-control.ps1"),
        "-Action",
        "status",
        "-StateDir",
        this.directory,
      ]);
      return JSON.parse(raw) as ProtectionState;
    } catch (error) {
      return {
        daemon: false,
        installed: false,
        oneDrive: false,
        error: error instanceof Error ? error.message : String(error),
        log: [],
        legacy: [],
      };
    }
  }
  async save(config: ProtectionConfig) {
    const bounds: [number, number, number][] = [
      [config.idleSeconds, 10, 3600],
      [config.maxPauseMinutes, 1, 1440],
      [config.settleMaxMinutes, 1, 1440],
      [config.pollSeconds, 1, 60],
    ];
    if (
      !config.watchRoots?.length ||
      !config.watchRoots.every(
        (path) => typeof path === "string" && path.trim().length,
      ) ||
      bounds.some(
        ([value, min, max]) =>
          !Number.isFinite(value) || value < min || value > max,
      ) ||
      !Array.isArray(config.ignoreDirs) ||
      !Array.isArray(config.ignoreFiles) ||
      [...config.ignoreDirs, ...config.ignoreFiles].some(
        (value) => typeof value !== "string",
      ) ||
      typeof config.scratchDir !== "string"
    )
      throw new Error("Check the watched folders and timing values.");
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, "config.jsonc"),
      temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(config, null, 2));
    await rename(temporary, file);
  }
  async action(action: string, path?: string) {
    if (!this.desktop)
      throw new Error("Open the desktop app to control OneDrive.");
    if (
      ![
        "install",
        "uninstall",
        "start",
        "stop",
        "probe",
        "restore-all",
        "on",
        "off",
      ].includes(action)
    )
      throw new Error("Unknown protection action.");
    return this.run(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        join(this.scripts, "desktop-control.ps1"),
        "-Action",
        action,
        "-StateDir",
        this.directory,
        ...(path ? ["-Target", path] : []),
      ],
      { timeout: 180_000 },
    );
  }
}
