import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Preferences } from "./types";

const SNAPSHOT_FILE = "companion-preferences.json";

export function companionPreferencesRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codepulse");
}

export function companionPreferencesSnapshotPath(root: string): string {
  return path.join(root, SNAPSHOT_FILE);
}

function cleanPreferences(preferences: Preferences): Preferences {
  return {
    activeWindowMinutes: preferences.activeWindowMinutes,
    monitorProjects: preferences.monitorProjects,
  };
}

export async function saveCompanionPreferencesSnapshot(
  root: string,
  preferences: Preferences,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    companionPreferencesSnapshotPath(root),
    `${JSON.stringify(cleanPreferences(preferences), null, 2)}\n`,
    "utf8",
  );
}

export async function loadCompanionPreferencesSnapshot(
  root: string,
): Promise<Preferences | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(companionPreferencesSnapshotPath(root), "utf8"),
    ) as Preferences;

    return cleanPreferences(parsed);
  } catch {
    return undefined;
  }
}

export async function resolveCompanionPreferences(
  root: string,
  fallback: Preferences,
): Promise<Preferences> {
  const snapshot = await loadCompanionPreferencesSnapshot(root);

  return {
    activeWindowMinutes:
      snapshot?.activeWindowMinutes ?? fallback.activeWindowMinutes,
    monitorProjects: snapshot?.monitorProjects ?? fallback.monitorProjects,
  };
}
