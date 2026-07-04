import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WslContext {
  distro: string;
  home: string;
  homeUncPath: string;
}

export type ExecFileLike = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr?: string }>;

function cleanWslOutput(output: string): string {
  return output.replaceAll("\u0000", "").replace(/\r/g, "");
}

export function parseDefaultDistroFromList(output: string): string | undefined {
  const lines = cleanWslOutput(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const defaultLine = lines.find((line) => line.startsWith("*"));
  if (!defaultLine) {
    return undefined;
  }

  return (
    defaultLine
      .replace(/^\*\s*/, "")
      .trim()
      .split(/\s{2,}|\sRunning|\sStopped/)[0]
      ?.trim() || undefined
  );
}

export function parseWslHome(output: string): string | undefined {
  const home = cleanWslOutput(output).trim();
  return home.startsWith("/") ? home : undefined;
}

export function toWslUncPath(
  distro: string,
  wslPath: string,
): string | undefined {
  if (!distro || !wslPath.startsWith("/")) {
    return undefined;
  }

  return `\\\\wsl$\\${distro}\\${wslPath
    .split("/")
    .filter(Boolean)
    .join("\\")}`;
}

async function defaultExecFile(file: string, args: string[]) {
  const result = await execFileAsync(file, args, { windowsHide: true });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function resolveDefaultWslContext(
  execFileImpl: ExecFileLike = defaultExecFile,
): Promise<WslContext> {
  const list = await execFileImpl("wsl.exe", ["-l", "-v"]);
  const distro = parseDefaultDistroFromList(list.stdout);
  if (!distro) {
    throw new Error("Unable to resolve default WSL2 distro");
  }

  const homeResult = await execFileImpl("wsl.exe", [
    "-d",
    distro,
    "sh",
    "-lc",
    'printf %s "$HOME"',
  ]);
  const home = parseWslHome(homeResult.stdout);
  if (!home) {
    throw new Error(`Unable to resolve WSL home for ${distro}`);
  }

  const homeUncPath = toWslUncPath(distro, home);
  if (!homeUncPath) {
    throw new Error(`Unable to convert WSL home for ${distro}`);
  }

  return { distro, home, homeUncPath };
}
