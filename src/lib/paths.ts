import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function projectNameFromCwd(
  cwd: string | undefined,
  fallback = "Unknown",
): string {
  if (!cwd) {
    return fallback;
  }

  return path.basename(cwd) || cwd;
}

export function parseMonitorProjectPrefixes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => expandHome(item.trim()))
    .filter(Boolean);
}

export function matchesMonitorPrefixes(
  cwd: string | undefined,
  prefixes: string[],
): boolean {
  if (prefixes.length === 0) {
    return true;
  }

  if (!cwd) {
    return false;
  }

  return prefixes.some(
    (prefix) => cwd === prefix || cwd.startsWith(`${prefix}${path.sep}`),
  );
}
