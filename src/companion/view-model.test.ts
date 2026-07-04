import { describe, expect, it } from "vitest";
import type { SessionRecord, StateSnapshot } from "../lib/types";

type ViewModelModule = typeof import("./view-model");

async function loadViewModelModule(): Promise<Partial<ViewModelModule>> {
  try {
    return await import("./view-model");
  } catch {
    return {};
  }
}

function createSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: "session-1",
    agent: "codex",
    status: "idle",
    source: "passive",
    projectName: "project",
    title: "project",
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

function createSnapshot(sessions: SessionRecord[]): StateSnapshot {
  const counts = {
    running: sessions.filter((session) => session.status === "running").length,
    waiting: sessions.filter((session) => session.status === "waiting").length,
    done: sessions.filter((session) => session.status === "done").length,
    idle: sessions.filter((session) => session.status === "idle").length,
    error: sessions.filter((session) => session.status === "error").length,
  };

  return {
    generatedAt: "2026-07-03T12:00:00.000Z",
    sessions,
    counts,
  };
}

describe("floating companion view model", () => {
  it("waiting dominates running and returns 轮到你了 1 个", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "waiting", status: "waiting" }),
      createSession({ id: "running", status: "running" }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, {
      platform: "win32",
      wslDistro: "Ubuntu",
    });

    expect(statusText?.(model as never)).toBe("轮到你了 1 个");
  });

  it("running returns 运行中 1 个", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "running", status: "running" }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, {
      platform: "darwin",
    });

    expect(statusText?.(model as never)).toBe("运行中 1 个");
  });

  it("returns WSL 不可用 when WSL is unavailable", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(undefined, {
      platform: "win32",
      unavailableReason: "wsl.exe failed",
    });

    expect(statusText?.(model as never)).toBe("WSL 不可用");
  });

  it("includes WSL and UNC copy actions on Windows", async () => {
    const { sessionCopyActions } = await loadViewModelModule();
    const session = createSession({
      cwd: "/home/user/project",
      status: "running",
    });

    expect(
      sessionCopyActions?.(session, {
        platform: "win32",
        wslDistro: "Ubuntu",
      }),
    ).toEqual([
      {
        id: "copy-wsl-path",
        label: "复制 WSL 路径",
        value: "/home/user/project",
      },
      {
        id: "copy-unc-path",
        label: "复制 Windows 路径",
        value: "\\\\wsl$\\Ubuntu\\home\\user\\project",
      },
    ]);
  });

  it("includes only local path copy action on macOS", async () => {
    const { sessionCopyActions } = await loadViewModelModule();
    const session = createSession({
      cwd: "/Users/me/project",
      status: "running",
    });

    expect(
      sessionCopyActions?.(session, {
        platform: "darwin",
      }),
    ).toEqual([
      {
        id: "copy-local-path",
        label: "复制路径",
        value: "/Users/me/project",
      },
    ]);
  });
});
