import { describe, expect, it, vi } from "vitest";
import type { Preferences } from "../lib/types";
import type { WslContext } from "../lib/wsl";

type StateSourceModule = typeof import("./state-source");

async function loadStateSourceModule(): Promise<Partial<StateSourceModule>> {
  try {
    return await import("./state-source");
  } catch {
    return {};
  }
}

const preferences: Preferences = {
  activeWindowMinutes: "5",
  monitorProjects: "/home/user/project",
};

describe("companion state source", () => {
  it("uses default local scan roots on darwin and skips WSL resolution", async () => {
    const { resolveCompanionStateSource } = await loadStateSourceModule();
    const resolveDefaultWslContext = vi.fn<() => Promise<WslContext>>();

    const source = await resolveCompanionStateSource?.("darwin", {
      stateRoot: "/tmp/codepulse-companion",
      preferences,
      resolveDefaultWslContext,
    });

    expect(resolveDefaultWslContext).not.toHaveBeenCalled();
    expect(source).toMatchObject({
      kind: "available",
      platform: "darwin",
      stateConfig: {
        stateRoot: "/tmp/codepulse-companion",
        preferences,
      },
      viewModelContext: {
        platform: "darwin",
      },
    });
    expect(
      source && "stateConfig" in source
        ? source.stateConfig.scanRoots
        : undefined,
    ).toBeUndefined();
    expect(
      source && "stateConfig" in source
        ? source.stateConfig.eventRoot
        : undefined,
    ).toBeUndefined();
  });

  it("uses resolveDefaultWslContext and builds WSL UNC roots on win32", async () => {
    const { resolveCompanionStateSource } = await loadStateSourceModule();
    const resolveDefaultWslContext = vi.fn(async () => ({
      distro: "Ubuntu",
      home: "/home/user",
      homeUncPath: "\\\\wsl$\\Ubuntu\\home\\user",
    }));

    const source = await resolveCompanionStateSource?.("win32", {
      stateRoot: "C:\\Users\\me\\AppData\\Roaming\\CodePulse",
      preferences,
      resolveDefaultWslContext,
    });

    expect(resolveDefaultWslContext).toHaveBeenCalledTimes(1);
    expect(source).toMatchObject({
      kind: "available",
      platform: "win32",
      stateConfig: {
        stateRoot: "C:\\Users\\me\\AppData\\Roaming\\CodePulse",
        eventRoot: "\\\\wsl$\\Ubuntu\\home\\user\\.codepulse\\events",
        scanRoots: {
          claudeProjectsRoot: "\\\\wsl$\\Ubuntu\\home\\user\\.claude\\projects",
          codexSessionsRoot: "\\\\wsl$\\Ubuntu\\home\\user\\.codex\\sessions",
        },
        preferences,
      },
      viewModelContext: {
        platform: "win32",
        wslDistro: "Ubuntu",
      },
    });
  });

  it("returns unavailable reason instead of throwing when WSL resolution fails", async () => {
    const { resolveCompanionStateSource } = await loadStateSourceModule();
    const resolveDefaultWslContext = vi.fn(async () => {
      throw new Error("wsl.exe exited with code 1");
    });

    await expect(
      resolveCompanionStateSource?.("win32", {
        stateRoot: "C:\\Users\\me\\AppData\\Roaming\\CodePulse",
        preferences,
        resolveDefaultWslContext,
      }),
    ).resolves.toMatchObject({
      kind: "unavailable",
      platform: "win32",
      unavailableReason: "wsl.exe exited with code 1",
      viewModelContext: {
        platform: "win32",
        unavailableReason: "wsl.exe exited with code 1",
      },
    });
  });
});
