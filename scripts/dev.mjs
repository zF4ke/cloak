import { createServer } from "vite";
import { build } from "esbuild";
import { spawn } from "node:child_process";
await build({
  entryPoints: ["src/dev.ts"],
  outfile: "dist/dev.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["electron"],
});
const backend = spawn(process.execPath, ["dist/dev.cjs"], {
  stdio: "inherit",
  windowsHide: true,
});
const vite = await createServer({
  root: ".",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/release/**",
        "**/dist/**",
        "**/tmp/**",
        "**/design-skill/**",
      ],
    },
    proxy: { "/api": "http://127.0.0.1:43180" },
  },
  appType: "spa",
});
await vite.listen();
vite.printUrls();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  backend.kill();
  await vite.close();
  process.exit();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
backend.on("exit", (code) => {
  if (!closing) {
    console.error(`Preview service exited (${code}).`);
    void close();
  }
});
