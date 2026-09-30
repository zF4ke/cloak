import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Service } from "./core/service.ts";
import { run } from "./core/commands.ts";
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
    await service.initialize();
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
      console.log(
        await run(
          "powershell.exe",
          [
            "-NoProfile",
            "-File",
            join(service.scripts, "cloak.ps1"),
            "-Command",
            command!,
            ...(argument ? ["-Arg", argument] : []),
            ...rest,
          ],
          { timeout: 180_000 },
        ),
      );
    } else if (command === "projects") {
      const views = await service.projects.views();
      for (const project of views)
        console.log(
          `${project.name}\n  ${project.path}\n  ${project.git?.branch ?? "unavailable"}${project.git?.changes.length ? `, ${project.git.changes.length} changes` : ""}`,
        );
      if (!views.length)
        console.log("No managed projects. Use cloak new, add or clone.");
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
          "Add --confirm to authorize project setup, the folder move/link, and repository creation if needed. Repositories are private by default.",
        );
      const mode =
        command === "new" ? "new" : command === "add" ? "import" : "clone";
      const inspection =
        mode === "import"
          ? await service.projects.inspect(argument)
          : undefined;
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
            : inspection?.git?.remote || name.replace(/\s+/g, "-"),
        visibility: options.has("--public") ? "public" : "private",
        createRepository: mode !== "clone" && !inspection?.git?.remote,
        useRemote: Boolean(inspection?.git?.remote),
      });
      console.log(`Added ${result.project.name}\n${result.project.path}`);
      if (result.warning) console.error(result.warning);
    } else
      throw new Error(
        "Commands: projects, new, add, clone, sync, check. The original OneDrive commands remain in cloak.ps1.",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    service.close();
  }
}
void main();
