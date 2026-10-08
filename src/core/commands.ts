import { spawn } from "node:child_process";
export type Run = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<string>;
export const run: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 30_000,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GH_PROMPT_DISABLED: "1",
      },
    });
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0)
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `Command ${command} ${signal ? `stopped with ${signal}` : `exited with code ${code}`}.`,
          ),
        );
      else
        resolve(
          Buffer.concat(stdout)
            .toString("utf8")
            .replace(/\r?\n$/, ""),
        );
    });
  });
