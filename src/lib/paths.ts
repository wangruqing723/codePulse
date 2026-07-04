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

function normalizeForBoundaryMatch(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized === "/") {
    return normalized;
  }

  return normalized.replace(/\/+$/, "");
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

  const normalizedCwd = normalizeForBoundaryMatch(cwd);

  return prefixes.some((prefix) => {
    const normalizedPrefix = normalizeForBoundaryMatch(prefix);
    return (
      normalizedCwd === normalizedPrefix ||
      normalizedCwd.startsWith(`${normalizedPrefix}/`)
    );
  });
}
