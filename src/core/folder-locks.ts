import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { exists } from "./paths.ts";
import type { Run } from "./commands.ts";
import type { FolderLocks, LockingApp } from "../shared/types.ts";

/** File Locksmith finds directory handles that Restart Manager cannot inspect. */
export class FolderUnlocker {
  private tickets = new Map<
    string,
    {
      path: string;
      dev: bigint;
      ino: bigint;
      apps: LockingApp[];
      expires: number;
    }
  >();
  constructor(
    private scripts: string,
    private run: Run,
    private candidates = [
      join(
        process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
        "PowerToys",
        "FileLocksmithCLI.exe",
      ),
      join(
        process.env.ProgramFiles || "C:\\Program Files",
        "PowerToys",
        "FileLocksmithCLI.exe",
      ),
    ],
  ) {}
  private async tool() {
    for (const candidate of this.candidates)
      if (await exists(candidate)) return candidate;
    return undefined;
  }
  private async helper(
    action: string,
    apps: { pid: number; name: string; started?: string }[],
  ) {
    return JSON.parse(
      await this.run(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(this.scripts, "folder-locks.ps1"),
          "-Payload",
          Buffer.from(
            JSON.stringify({ action, owner: process.pid, processes: apps }),
          ).toString("base64"),
        ],
        { timeout: 30_000 },
      ),
    ) as LockingApp[];
  }
  private async scan(tool: string, path: string) {
    const data = JSON.parse(
      await this.run(tool, ["--json", path], { timeout: 60_000 }),
    );
    if (!Array.isArray(data.processes))
      throw new Error("File Locksmith returned an unreadable process list.");
    return data.processes.filter(
      (p: { pid: number; name: string }) =>
        Number.isInteger(p.pid) && p.pid > 0 && typeof p.name === "string",
    ) as { pid: number; name: string }[];
  }
  async inspect(path: string): Promise<FolderLocks> {
    if (typeof path !== "string") throw new Error("Choose a project folder.");
    const folder = await realpath(path);
    const stat = await lstat(folder, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Choose the real project folder.");
    const tool = process.platform === "win32" ? await this.tool() : undefined;
    if (!tool)
      return {
        available: false,
        apps: [],
        message:
          "Install Microsoft PowerToys for automatic unlocking, or close apps using this folder and retry.",
      };
    const apps = await this.helper("inspect", await this.scan(tool, folder));
    for (const [key, ticket] of this.tickets)
      if (ticket.expires < Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 16)
      this.tickets.delete(this.tickets.keys().next().value!);
    const token = randomUUID();
    this.tickets.set(token, {
      path: folder,
      dev: stat.dev,
      ino: stat.ino,
      apps,
      expires: Date.now() + 600_000,
    });
    return { available: true, token, apps };
  }
  async close(token: string, force: boolean): Promise<FolderLocks> {
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.expires < Date.now())
      throw new Error("Check locking apps again before closing them.");
    if (typeof force !== "boolean")
      throw new Error("Choose how to close the locking apps.");
    this.tickets.delete(token);
    const stat = await lstat(ticket.path, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      stat.dev !== ticket.dev ||
      stat.ino !== ticket.ino ||
      resolve(await realpath(ticket.path)) !== resolve(ticket.path)
    )
      throw new Error("The project folder changed. Inspect it again.");
    const tool = await this.tool();
    if (!tool)
      throw new Error(
        "PowerToys is no longer available. Close the apps manually.",
      );
    const current = new Set(
      (await this.scan(tool, ticket.path)).map((p) => p.pid),
    );
    const apps = ticket.apps.filter(
      (app) => current.has(app.pid) && !app.protected,
    );
    await this.helper(force ? "end" : "close", apps);
    const result = await this.inspect(ticket.path);
    result.message = result.apps.length
      ? "Some tasks still hold the folder. Close their parent app, or end the listed tasks."
      : "No locking apps found. Retry the import. Windows may still have locks this account cannot inspect.";
    return result;
  }
}
