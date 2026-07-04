import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  companionPreferencesRoot,
  companionPreferencesSnapshotPath,
  loadCompanionPreferencesSnapshot,
  resolveCompanionPreferences,
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
});
