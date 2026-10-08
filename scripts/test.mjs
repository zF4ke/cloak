import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: [
    "tests/projects.test.ts",
    "tests/folder-picker.test.ts",
    "tests/github-status.test.ts",
    "tests/install.test.ts",
    "tests/lock.test.ts",
    "tests/package.test.ts",
    "tests/recovery-cleanup.test.ts",
    "tests/folder-locks.test.ts",
    "tests/cloud-move.test.ts",
    "tests/protection-refresh.test.ts",
  ],
  outdir: "dist/tests",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["original-fs"],
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "dist/tests/projects.test.cjs",
    "dist/tests/folder-picker.test.cjs",
    "dist/tests/github-status.test.cjs",
    "dist/tests/install.test.cjs",
    "dist/tests/lock.test.cjs",
    "dist/tests/package.test.cjs",
    "dist/tests/recovery-cleanup.test.cjs",
    "dist/tests/folder-locks.test.cjs",
    "dist/tests/cloud-move.test.cjs",
    "dist/tests/protection-refresh.test.cjs",
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
