import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["tests/projects.test.ts", "tests/install.test.ts"],
  outdir: "dist/tests",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
const result = spawnSync(
  process.execPath,
  ["--test", "dist/tests/projects.test.cjs", "dist/tests/install.test.cjs"],
  { stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
