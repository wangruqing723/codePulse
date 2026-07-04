import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attachChildLifecycle } from "./run-companion-dev-lib.mjs";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const companionEntry = path.join(rootDir, "dist-companion", "main.cjs");

function waitForForegroundProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

async function main() {
  await waitForForegroundProcess(npmCommand, ["run", "companion:build"]);

  const child = spawn(electronBinary, [companionEntry], {
    cwd: rootDir,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });

  attachChildLifecycle(child);
}

await main();
