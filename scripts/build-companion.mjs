import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "dist-companion");
const assetsOutDir = path.join(outDir, "assets");

async function buildMain() {
  await build({
    entryPoints: [path.join(rootDir, "src/companion/main.ts")],
    bundle: true,
    outfile: path.join(outDir, "main.cjs"),
    format: "cjs",
    platform: "node",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  });
}

async function buildPreload() {
  await build({
    entryPoints: [path.join(rootDir, "src/companion/preload.ts")],
    bundle: true,
    outfile: path.join(outDir, "preload.cjs"),
    format: "cjs",
    platform: "node",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  });
}

async function buildKill() {
  await build({
    entryPoints: [path.join(rootDir, "src/companion/kill.ts")],
    bundle: true,
    outfile: path.join(outDir, "kill.cjs"),
    format: "cjs",
    platform: "node",
    target: "node22",
    sourcemap: true,
  });
}

async function buildRenderer() {
  await build({
    entryPoints: [path.join(rootDir, "src/companion/renderer.tsx")],
    bundle: true,
    outfile: path.join(outDir, "renderer.js"),
    format: "iife",
    platform: "browser",
    target: "chrome140",
    sourcemap: true,
  });
}

async function buildStyles() {
  await build({
    entryPoints: [path.join(rootDir, "src/companion/styles.css")],
    bundle: true,
    outfile: path.join(outDir, "styles.css"),
  });
}

async function copyAssets() {
  await mkdir(assetsOutDir, { recursive: true });
  await copyFile(
    path.join(rootDir, "assets/codepulse-icon-v2.png"),
    path.join(assetsOutDir, "codepulse-icon-v2.png"),
  );
}

async function writeHtml() {
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1"
    />
    <title>CodePulse Companion</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="./renderer.js"></script>
  </body>
</html>
`;

  await writeFile(path.join(outDir, "index.html"), html, "utf8");
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await Promise.all([
    buildMain(),
    buildKill(),
    buildPreload(),
    buildRenderer(),
    buildStyles(),
    copyAssets(),
  ]);
  await writeHtml();
}

await main();
