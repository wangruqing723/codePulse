import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const releaseDir = path.join(rootDir, "release");
const version = packageJson.version;
const tag = `codepulse-companion-v${version}`;
const appPath = path.join(releaseDir, "mac-arm64", "CodePulse Companion.app");
const zipName = "CodePulse-Companion-darwin-arm64.zip";
const zipPath = path.join(releaseDir, zipName);
const manifestPath = path.join(releaseDir, "codepulse-companion-manifest.json");

await mkdir(releaseDir, { recursive: true });
await execFileAsync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);

const zipBytes = await readFile(zipPath);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const manifest = {
  version,
  artifacts: {
    "darwin-arm64": {
      url: `https://github.com/wangruqing723/codePulse/releases/download/${tag}/${zipName}`,
      sha256,
      entrypoint: "CodePulse Companion.app",
    },
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${zipPath}`);
console.log(`Wrote ${manifestPath}`);
