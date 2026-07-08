import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearCodexNotifyBackup,
  companionPreferencesRoot,
  companionPreferencesSnapshotPath,
  loadCodexNotifyBackup,
  loadCompanionEventRoot,
  loadCompanionPreferencesSnapshot,
  resolveCompanionPreferences,
  saveCodexNotifyBackup,
  saveCompanionPreferencesSnapshot,
} from "./companion-preferences";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "codepulse-companion-preferences-"));
}

describe("companion preferences snapshot", () => {
  it("uses a shared home-based root for Raycast and companion processes", () => {
    expect(companionPreferencesRoot("/Users/me")).toBe("/Users/me/.codepulse");
  });

  it("loads snapshot preferences over fallback values", async () => {
    const root = await tempRoot();

    await saveCompanionPreferencesSnapshot(root, {
      activeWindowMinutes: "30",
      monitorProjects: "/Users/me/project",
    });

    await expect(
      resolveCompanionPreferences(root, {
        activeWindowMinutes: "5",
        monitorProjects: undefined,
      }),
    ).resolves.toEqual({
      activeWindowMinutes: "30",
      monitorProjects: "/Users/me/project",
    });
  });

  it("returns fallback preferences when snapshot is missing", async () => {
    const root = await tempRoot();
    const fallback = {
      activeWindowMinutes: "9",
      monitorProjects: "/tmp/project",
    };

    await expect(resolveCompanionPreferences(root, fallback)).resolves.toEqual(
      fallback,
    );
  });

  it("returns fallback preferences when snapshot is malformed", async () => {
    const root = await tempRoot();
    const fallback = {
      activeWindowMinutes: "7",
      monitorProjects: "/tmp/fallback",
    };
    await mkdir(root, { recursive: true });
    await writeFile(companionPreferencesSnapshotPath(root), "{nope", "utf8");

    await expect(resolveCompanionPreferences(root, fallback)).resolves.toEqual(
      fallback,
    );
  });

  it("round-trips the shared hook eventRoot for the companion process", async () => {
    const root = await tempRoot();
    const eventRoot = "/Users/me/Library/Application Support/raycast/events";

    await saveCompanionPreferencesSnapshot(
      root,
      { activeWindowMinutes: "5", monitorProjects: undefined },
      eventRoot,
    );

    await expect(loadCompanionEventRoot(root)).resolves.toBe(eventRoot);
  });

  it("returns undefined eventRoot when the snapshot omits it", async () => {
    const root = await tempRoot();

    await saveCompanionPreferencesSnapshot(root, {
      activeWindowMinutes: "5",
      monitorProjects: undefined,
    });

    await expect(loadCompanionEventRoot(root)).resolves.toBeUndefined();
  });

  it("returns undefined eventRoot when the snapshot is missing", async () => {
    const root = await tempRoot();

    await expect(loadCompanionEventRoot(root)).resolves.toBeUndefined();
  });

  it("loads only companion monitoring preferences from a snapshot", async () => {
    const root = await tempRoot();

    await saveCompanionPreferencesSnapshot(root, {
      activeWindowMinutes: "15",
      menuBarStyle: "session",
      monitorProjects: "/Users/me/project",
    });

    await expect(loadCompanionPreferencesSnapshot(root)).resolves.toEqual({
      activeWindowMinutes: "15",
      monitorProjects: "/Users/me/project",
    });
  });

  it("round-trips a force-overwritten Codex notify backup", async () => {
    const root = await tempRoot();
    const notify = 'notify = ["/opt/tool", "turn-ended"]';

    await saveCodexNotifyBackup(root, notify);

    await expect(loadCodexNotifyBackup(root)).resolves.toBe(notify);
  });

  it("returns undefined when no Codex notify backup exists", async () => {
    const root = await tempRoot();

    await expect(loadCodexNotifyBackup(root)).resolves.toBeUndefined();
  });

  it("clears the Codex notify backup and tolerates a missing file", async () => {
    const root = await tempRoot();

    await saveCodexNotifyBackup(root, 'notify = ["/opt/tool"]');
    await clearCodexNotifyBackup(root);
    await expect(loadCodexNotifyBackup(root)).resolves.toBeUndefined();

    // 再次清理不存在的备份不应抛错。
    await expect(clearCodexNotifyBackup(root)).resolves.toBeUndefined();
  });
});
