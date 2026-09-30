import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: [
    "tests/projects.test.ts",
    "tests/install.test.ts",
    "tests/lock.test.ts",
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
    "dist/tests/install.test.cjs",
    "dist/tests/lock.test.cjs",
  ],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
