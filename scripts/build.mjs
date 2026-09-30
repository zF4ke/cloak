import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
await mkdir("dist/app", { recursive: true });
await mkdir("dist/renderer", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await build({
  entryPoints: ["src/app/entry.ts"],
  outfile: "dist/app/main.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: {
    preload: "src/app/preload.ts",
    "setup-preload": "src/setup/preload.ts",
  },
  outdir: "dist/app",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
});
await build({
  entryPoints: ["src/ui/main.tsx"],
  outfile: "dist/renderer/app.js",
  bundle: true,
  platform: "browser",
  target: "chrome142",
  sourcemap: true,
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = (await readFile("src/ui/index.html", "utf8"))
  .replace("/src/ui/main.tsx", "./app.js")
  .replace("</head>", '<link rel="stylesheet" href="./app.css"></head>');
await writeFile("dist/renderer/index.html", html);
await copyFile("assets/icon.png", "dist/assets/icon.png");
await copyFile("assets/icon.ico", "dist/assets/icon.ico");
await mkdir("dist/renderer/assets", { recursive: true });
await copyFile("assets/mark.svg", "dist/renderer/assets/mark.svg");
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
await mkdir("dist/setup", { recursive: true });
await build({
  entryPoints: ["src/setup/renderer.tsx"],
  outfile: "dist/setup/renderer.js",
  bundle: true,
  platform: "browser",
  target: "chrome142",
  jsx: "automatic",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __SETUP_MARK__: '"./mark.svg"',
  },
});
await writeFile(
  "dist/setup/index.html",
  (await readFile("src/setup/index.html", "utf8"))
    .replace("/src/setup/renderer.tsx", "./renderer.js")
    .replace("</head>", '<link rel="stylesheet" href="./renderer.css"></head>'),
);
await copyFile("assets/mark.svg", "dist/setup/mark.svg");
