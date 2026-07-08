import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Preferences } from "./types";

const SNAPSHOT_FILE = "companion-preferences.json";

// 快照除了同步监控偏好，还携带 Raycast 进程的 hook 事件目录路径（eventRoot）。
// 悬浮窗是独立的 Electron 进程，拥有自己的 stateRoot，默认读不到 Raycast 写入
// 的 hook 事件（waiting/error 等即时状态），只能靠被动扫描。把 eventRoot 通过
// 这个共享文件传给悬浮窗，两个进程就能合并同一份 hook 事件。
interface CompanionSnapshot extends Preferences {
  eventRoot?: string;
}

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
  eventRoot?: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  const snapshot: CompanionSnapshot = {
    ...cleanPreferences(preferences),
    ...(eventRoot ? { eventRoot } : {}),
  };
  await writeFile(
    companionPreferencesSnapshotPath(root),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

export async function loadCompanionEventRoot(
  root: string,
): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(companionPreferencesSnapshotPath(root), "utf8"),
    ) as CompanionSnapshot;

    return typeof parsed.eventRoot === "string" && parsed.eventRoot.length > 0
      ? parsed.eventRoot
      : undefined;
  } catch {
    return undefined;
  }
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

const CODEX_NOTIFY_BACKUP_FILE = "codex-notify-backup.json";

interface CodexNotifyBackup {
  notify: string;
  savedAt: string;
}

export function codexNotifyBackupPath(root: string): string {
  return path.join(root, CODEX_NOTIFY_BACKUP_FILE);
}

// force 覆盖 Codex notify 前，把被顶掉的用户既有 notify 无损存到 ~/.codepulse。
// 不同于 config.toml.codepulse.bak 的“存在即跳过”一次性备份，这里每次覆盖都会
// 刷新，确保存的是覆盖前的真实配置，供卸载时精确还原。
export async function saveCodexNotifyBackup(
  root: string,
  notify: string,
): Promise<void> {
  await mkdir(root, { recursive: true });
  const backup: CodexNotifyBackup = {
    notify,
    savedAt: new Date().toISOString(),
  };
  await writeFile(
    codexNotifyBackupPath(root),
    `${JSON.stringify(backup, null, 2)}\n`,
    "utf8",
  );
}

export async function loadCodexNotifyBackup(
  root: string,
): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(codexNotifyBackupPath(root), "utf8"),
    ) as CodexNotifyBackup;

    return typeof parsed.notify === "string" && parsed.notify.length > 0
      ? parsed.notify
      : undefined;
  } catch {
    return undefined;
  }
}

export async function clearCodexNotifyBackup(root: string): Promise<void> {
  await rm(codexNotifyBackupPath(root), { force: true });
}
