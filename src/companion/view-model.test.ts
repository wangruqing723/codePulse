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
  it.each([
    ["running", "green", "运行中"],
    ["done", "blue", "完成"],
    ["error", "red", "错误"],
    ["waiting", "yellow", "等待"],
  ] as const)(
    "builds the %s dominant badge with its shared status tone",
    async (status, tone, label) => {
      const { buildBadgeViewModel } = await loadViewModelModule();
      const snapshot = createSnapshot([
        createSession({ id: status, status }),
        createSession({ id: "idle", status: "idle" }),
      ]);

      expect(buildBadgeViewModel?.(snapshot, { platform: "darwin" })).toEqual({
        status,
        tone,
        totalCount: 1,
        label: `1 个${label}`,
      });
    },
  );

  it("uses the established dominant-status order and counts only the dominant status", async () => {
    const { buildBadgeViewModel } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "done", status: "done" }),
      createSession({ id: "running", status: "running" }),
      createSession({ id: "waiting", status: "waiting" }),
      createSession({ id: "error", status: "error" }),
      createSession({ id: "error-2", status: "error" }),
      createSession({ id: "idle", status: "idle" }),
    ]);

    expect(buildBadgeViewModel?.(snapshot, { platform: "darwin" })).toEqual({
      status: "error",
      tone: "red",
      totalCount: 2,
      label: "2 个错误",
    });
  });

  it("builds a neutral empty badge and leaves presentation unset", async () => {
    const { buildBadgeViewModel, buildFloatingViewModel } =
      await loadViewModelModule();
    const snapshot = createSnapshot([createSession({ status: "idle" })]);

    expect(buildBadgeViewModel?.(snapshot, { platform: "darwin" })).toEqual({
      status: "empty",
      tone: "blue",
      totalCount: 0,
      label: "暂无活跃会话",
    });

    const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });
    expect(model?.badge).toEqual({
      status: "empty",
      tone: "blue",
      totalCount: 0,
      label: "暂无活跃会话",
    });
    expect(model?.presentation).toBeUndefined();
  });

  it("builds an empty badge when no snapshot is available", async () => {
    const { buildBadgeViewModel } = await loadViewModelModule();

    expect(buildBadgeViewModel?.(undefined, { platform: "darwin" })).toEqual({
      status: "empty",
      tone: "blue",
      totalCount: 0,
      label: "暂无活跃会话",
    });
  });

  it("summarizes delegated Codex work separately from user sessions", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "running-user", status: "running" }),
      createSession({
        id: "running-delegated",
        status: "running",
        origin: "delegated",
      } as Partial<SessionRecord>),
    ]);

    const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });

    expect(statusText?.(model as never)).toBe("🟢 1 运行中  🟢 1 委托中");
    expect(model?.summaryItems).toEqual([
      { status: "running", statusTone: "green", count: 1, label: "运行中" },
      { status: "running", statusTone: "green", count: 1, label: "委托中" },
    ]);
  });

  it("uses delegated running sessions for the dominant model status", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({
        id: "running-delegated",
        status: "running",
        origin: "delegated",
      }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });

    expect(model?.status).toBe("running");
    expect(model?.count).toBe(1);
    expect(model?.sessions).toHaveLength(1);
    expect(model?.summaryItems).toEqual([
      { status: "running", statusTone: "green", count: 1, label: "委托中" },
    ]);
    expect(statusText?.(model as never)).toBe("🟢 1 委托中");
  });

  it("orders delegated error and waiting before user done globally", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "done-user", status: "done" }),
      createSession({
        id: "error-delegated",
        status: "error",
        origin: "delegated",
      }),
      createSession({
        id: "waiting-delegated",
        status: "waiting",
        origin: "delegated",
      }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });

    expect(model?.status).toBe("error");
    expect(model?.count).toBe(1);
    expect(model?.summaryItems).toEqual([
      { status: "error", statusTone: "red", count: 1, label: "委托出错" },
      {
        status: "waiting",
        statusTone: "yellow",
        count: 1,
        label: "委托待确认",
      },
      { status: "done", statusTone: "blue", count: 1, label: "完成" },
    ]);
    expect(statusText?.(model as never)).toBe(
      "🔴 1 委托出错  🟡 1 委托待确认  🔵 1 完成",
    );
  });

  it("summarizes only the four display statuses with error first", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "running-1", status: "running" }),
      createSession({ id: "running-2", status: "running" }),
      createSession({ id: "error", status: "error" }),
      createSession({ id: "idle", status: "idle" }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });

    expect(model?.status).toBe("error");
    expect(statusText?.(model as never)).toBe("🔴 1 错误  🟢 2 运行中");
    expect(model?.summaryItems).toEqual([
      { status: "error", statusTone: "red", count: 1, label: "错误" },
      { status: "running", statusTone: "green", count: 2, label: "运行中" },
    ]);
  });

  it("filters idle sessions out of card display", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({ id: "idle", status: "idle" }),
        createSession({ id: "waiting", status: "waiting", title: "等待确认" }),
      ]),
      { platform: "darwin" },
    );

    expect(model?.sessions).toHaveLength(1);
    expect(model?.sessions[0]?.session.id).toBe("waiting");
    expect(model?.sessions[0]?.displayStatus).toBe("waiting");
    expect(model?.sessions[0]?.statusTone).toBe("yellow");
  });

  it("summarizes waiting before running", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "waiting", status: "waiting" }),
      createSession({ id: "running", status: "running" }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, {
      platform: "win32",
      wslDistro: "Ubuntu",
    });

    expect(statusText?.(model as never)).toBe("🟡 1 等待  🟢 1 运行中");
  });

  it("summarizes running sessions", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const snapshot = createSnapshot([
      createSession({ id: "running", status: "running" }),
    ]);

    const model = buildFloatingViewModel?.(snapshot, {
      platform: "darwin",
    });

    expect(statusText?.(model as never)).toBe("🟢 1 运行中");
  });

  it("returns WSL 不可用 when WSL is unavailable", async () => {
    const { buildFloatingViewModel, statusText } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(undefined, {
      platform: "win32",
      unavailableReason: "wsl.exe failed",
    });

    expect(statusText?.(model as never)).toBe("WSL 不可用");
  });

  it("uses one UNC-first copy action on Windows", async () => {
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
        id: "copy-unc-path",
        label: "复制路径",
        value: "\\\\wsl$\\Ubuntu\\home\\user\\project",
      },
    ]);
  });

  it("adds context, duration, and shortened path fields to cards", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "error",
          status: "error",
          cwd: "/Users/wyong/docker/codePulse/plugins/my/plugin-todolist",
          title: "失败任务",
          errorMessage: "Command failed with exit code 1",
          updatedAt: "2026-07-03T12:00:00.000Z",
        }),
      ]),
      {
        platform: "darwin",
        now: new Date("2026-07-03T12:02:14.000Z"),
      } as never,
    );

    expect(model?.sessions[0]?.displayPath).toBe("~/.../my/plugin-todolist");
    expect(model?.sessions[0]?.fullPath).toContain(
      "/Users/wyong/docker/codePulse",
    );
    expect(model?.sessions[0]?.contextText).toBe(
      "Command failed with exit code 1",
    );
    expect(model?.sessions[0]?.durationText).toBe("02:14");
  });

  it("uses runningSince instead of updatedAt for active duration", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "running",
          status: "running",
          runningSince: "2026-07-03T11:55:00.000Z",
          lastEventAt: "2026-07-03T11:58:00.000Z",
          updatedAt: "2026-07-03T12:00:00.000Z",
        }),
      ]),
      {
        platform: "darwin",
        now: new Date("2026-07-03T12:02:14.000Z"),
      },
    );

    expect(model?.sessions[0]?.durationText).toBe("07:14");
  });

  it("uses completedAt for done duration when runningSince is present", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "done",
          status: "done",
          runningSince: "2026-07-03T11:55:00.000Z",
          updatedAt: "2026-07-03T12:00:00.000Z",
          completedAt: "2026-07-03T12:03:45.000Z",
        }),
      ]),
      {
        platform: "darwin",
        now: new Date("2026-07-03T12:10:00.000Z"),
      },
    );

    expect(model?.sessions[0]?.durationText).toBe("08:45");
  });

  it("uses waiting confirmation text when no explicit wait reason exists", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "waiting",
          status: "waiting",
          title: "project",
        }),
      ]),
      { platform: "darwin" },
    );

    expect(model?.sessions[0]?.contextText).toBe("等待用户确认");
  });

  it("leaves non-actionable session context empty when it would duplicate the title", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "running",
          status: "running",
          title: "plugin-todolist",
        }),
        createSession({
          id: "done",
          status: "done",
          title: "codePulse",
          completedAt: "2026-07-03T12:03:45.000Z",
        }),
      ]),
      { platform: "darwin" },
    );

    expect(model?.sessions.map((session) => session.contextText)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("middle-truncates long WSL slash paths while preserving the full path", async () => {
    const { buildFloatingViewModel } = await loadViewModelModule();
    const fullPath = "/home/user/very/long/project/src/tools/codePulse";
    const model = buildFloatingViewModel?.(
      createSnapshot([
        createSession({
          id: "running",
          status: "running",
          cwd: fullPath,
        }),
      ]),
      { platform: "win32", wslDistro: "Ubuntu" },
    );

    expect(model?.sessions[0]?.displayPath).toBe(
      "/home/user/.../tools/codePulse",
    );
    expect(model?.sessions[0]?.fullPath).toBe(fullPath);
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
