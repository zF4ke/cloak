import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Service } from "./core/service.ts";
async function main() {
  const service = new Service(
    process.env.CLOAK_DATA_DIR ||
      join(
        process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"),
        "cloak",
      ),
    process.env.CLOAK_SCRIPTS_DIR || process.cwd(),
    false,
  );
  try {
    const [command, argument, ...rest] = process.argv.slice(2);
    const options = new Set(rest);
    if (
      [
        "status",
        "install",
        "uninstall",
        "start",
        "stop",
        "log",
        "probe",
        "on",
        "off",
        "list",
        "restore-all",
      ].includes(command || "")
    ) {
      const trailing = [argument, ...rest].filter(
        (arg): arg is string => arg !== undefined,
      );
      const args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(service.scripts, "cloak.ps1"),
        "-Command",
        command!,
        ...trailing,
      ];
      process.exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn("powershell.exe", args, {
          stdio: "inherit",
          windowsHide: true,
        });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
      return;
    }
    await service.initialize();
    if (command === "projects") {
      const views = await service.projects.views();
      for (const project of views)
        console.log(
          `${project.name}\n  ${project.path}\n  ${project.git?.branch ?? "unavailable"}${project.git?.changes.length ? `, ${project.git.changes.length} changes` : ""}`,
        );
      if (!views.length)
        console.log("No managed projects. Use cloak new, add or clone.");
    } else if (command === "shortcuts") {
      const args = [argument, ...rest].filter(
        (value): value is string => value !== undefined,
      );
      if (!args.includes("--confirm"))
        throw new Error(
          "Use cloak shortcuts [project name] --confirm to create or repair folder shortcuts.",
        );
      const name = args.find((value) => value !== "--confirm");
      const projects = await service.projects.views();
      const selected = name
        ? projects.filter((project) => project.name === name)
        : projects;
      if (name && !selected.length) throw new Error("Project not found.");
      for (const project of selected) {
        await service.projects.repairLink(project.id);
        console.log(`Shortcut ready: ${project.name}`);
      }
    } else if (command === "cleanup") {
      await service.projects.cleanupRecoveries();
      if (service.projects.recoveryWarnings.length) {
        for (const warning of service.projects.recoveryWarnings)
          console.error(warning);
        process.exitCode = 1;
      } else console.log("Recovery cleanup complete.");
    } else if (command === "check") {
      await service.projects.checkUpdates(true);
      const views = await service.projects.views();
      for (const project of views)
        console.log(`${project.name}: ${project.update?.message || "checked"}`);
    } else if (command === "sync") {
      const projects = await service.projects.views();
      const project = projects.find((p) => p.name === argument);
      if (!project)
        throw new Error(
          "Use cloak sync <project name>. Commit local changes first.",
        );
      await service.projects.sync(project.id);
      console.log("Project synced.");
    } else if (["new", "add", "clone"].includes(command || "")) {
      if (!argument)
        throw new Error(
          `Use cloak ${command} <${command === "new" ? "name" : command === "add" ? "folder" : "GitHub URL"}> --confirm${command === "clone" ? "" : " [--public]"}.`,
        );
      if (!options.has("--confirm"))
        throw new Error(
          "Add --confirm to authorize project setup, the folder move/shortcut, and repository creation if needed. Repositories are private by default.",
        );
      await service.protection.refresh();
      const mode =
        command === "new" ? "new" : command === "add" ? "import" : "clone";
      const inspection =
        mode === "import"
          ? await service.projects.inspect(argument)
          : undefined;
      const recover = options.has("--use-remote-version");
      if (recover && mode !== "import")
        throw new Error(
          "--use-remote-version applies only to add. It replaces all local files and unpublished commits, including ignored files.",
        );
      const optionValue = (flag: string) => {
        const index = rest.indexOf(flag);
        if (index === -1) return undefined;
        const value = rest[index + 1];
        if (!value || value.startsWith("--"))
          throw new Error(`Give ${flag} a value.`);
        return value;
      };
      const recoveryRepository = recover
        ? optionValue("--repository") || inspection?.recovery?.remote
        : undefined;
      if (recover && !recoveryRepository)
        throw new Error(
          "Git cannot discover origin. Provide --repository <GitHub URL> with --use-remote-version.",
        );
      const name =
        mode === "new"
          ? argument
          : mode === "clone"
            ? argument
                .replace(/\/$/, "")
                .split(/[/:]/)
                .at(-1)!
                .replace(/\.git$/, "")
            : inspection!.name;
      const result = await service.projects.create({
        mode,
        name,
        source: inspection?.path,
        repository:
          mode === "clone"
            ? argument
            : recoveryRepository ||
              inspection?.git?.remote ||
              name.replace(/\s+/g, "-"),
        visibility: options.has("--public") ? "public" : "private",
        createRepository:
          mode !== "clone" && !inspection?.git?.remote && !recover,
        useRemote: Boolean(inspection?.git?.remote) || recover,
        recovery: recover
          ? {
              confirmed: true,
              branch: optionValue("--branch") || inspection?.recovery?.branch,
            }
          : undefined,
      });
      console.log(`Added ${result.project.name}\n${result.project.path}`);
      if (result.warning) console.error(result.warning);
    } else
      throw new Error(
        "Commands: projects, new, add, clone, sync, check, shortcuts, cleanup. The original OneDrive commands remain in cloak.ps1.",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    service.close();
  }
}
void main();
