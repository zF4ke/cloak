import { execFile } from "node:child_process";
export type Run = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<string>;
export const run: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout ?? 30_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GH_PROMPT_DISABLED: "1",
        },
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim()));
        else resolve(stdout.replace(/\r?\n$/, ""));
      },
    );
  });
