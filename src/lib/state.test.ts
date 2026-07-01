import { describe, expect, it } from "vitest";
import { applyDebounce, mergeHookEvents } from "./state";
import type { HookEvent, SessionRecord, StateSnapshot } from "./types";

function session(patch: Partial<SessionRecord> & Pick<SessionRecord, "id">) {
  const { id, ...rest } = patch;

  return {
    id,
    agent: patch.agent ?? "codex",
    status: patch.status ?? "done",
    source: patch.source ?? "passive",
    cwd: patch.cwd ?? "/tmp/project",
    projectName: patch.projectName ?? "project",
    title: patch.title ?? "project",
    updatedAt: patch.updatedAt ?? "2026-07-01T00:00:30.000Z",
    lastEventAt: patch.lastEventAt ?? patch.updatedAt,
    ...rest,
  } satisfies SessionRecord;
}

function hook(patch: Partial<HookEvent> & Pick<HookEvent, "id">) {
  const { id, ...rest } = patch;

  return {
    id,
    agent: patch.agent ?? "claude",
    kind: patch.kind ?? "running",
    timestamp: patch.timestamp ?? "2026-07-01T00:00:00.000Z",
    cwd: patch.cwd ?? "/tmp/project",
    ...rest,
  } satisfies HookEvent;
}

describe("hook event merging", () => {
  it("ignores Claude SessionStart hooks", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "startup",
          eventName: "SessionStart",
          sessionId: "claude-session",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:10.000Z"),
    );

    expect(sessions).toEqual([]);
  });

  it("drops stale hook-only running events without transcripts", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "startup",
          sessionId: "claude-session",
          timestamp: "2026-07-01T00:00:00.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:31.000Z"),
    );

    expect(sessions).toEqual([]);
  });

  it("does not let older hooks override newer passive transcript state", () => {
    const passiveDone = session({
      id: "claude:shared",
      agent: "claude",
      status: "done",
      updatedAt: "2026-07-01T00:01:00.000Z",
      lastEventAt: "2026-07-01T00:01:00.000Z",
    });
    const sessions = mergeHookEvents(
      [passiveDone],
      [
        hook({
          id: "prompt",
          sessionId: "shared",
          timestamp: "2026-07-01T00:00:10.000Z",
          eventName: "UserPromptSubmit",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:01:05.000Z"),
    );

    expect(sessions).toEqual([passiveDone]);
  });

  it("merges Codex hooks without session ids into matching passive sessions", () => {
    const passiveRunning = session({
      id: "codex:session-id",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:00:10.000Z",
      lastEventAt: "2026-07-01T00:00:10.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath: "/tmp/session.jsonl",
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "codex-done",
          agent: "codex",
          kind: "done",
          eventName: "agent-turn-complete",
          timestamp: "2026-07-01T00:00:20.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:21.000Z"),
    );

    expect(sessions).toEqual([
      {
        ...passiveRunning,
        status: "done",
        source: "hook",
        updatedAt: "2026-07-01T00:00:20.000Z",
        lastEventAt: "2026-07-01T00:00:20.000Z",
        completedAt: "2026-07-01T00:00:20.000Z",
      },
    ]);
  });

  it("does not create cwd-only Codex sessions for stale hooks", () => {
    const passiveRunning = session({
      id: "codex:session-id",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:01:00.000Z",
      lastEventAt: "2026-07-01T00:01:00.000Z",
      runningSince: "2026-07-01T00:00:30.000Z",
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "codex-stale-done",
          agent: "codex",
          kind: "done",
          eventName: "agent-turn-complete",
          timestamp: "2026-07-01T00:00:40.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:01:05.000Z"),
    );

    expect(sessions).toEqual([passiveRunning]);
  });
});

describe("state debounce", () => {
  it("shows passive running state immediately", () => {
    const previous: StateSnapshot = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      counts: {
        running: 0,
        waiting: 0,
        done: 1,
        idle: 0,
        error: 0,
      },
      sessions: [
        session({
          id: "codex:shared",
          status: "done",
          updatedAt: "2026-07-01T00:00:00.000Z",
        }),
      ],
    };
    const running = session({
      id: "codex:shared",
      status: "running",
      updatedAt: "2026-07-01T00:00:05.000Z",
      runningSince: "2026-07-01T00:00:05.000Z",
    });

    expect(applyDebounce(previous, [running])).toEqual([
      {
        ...running,
        pendingStatus: undefined,
        pendingCount: 0,
      },
    ]);
  });

  it("shows fresh passive done state immediately", () => {
    const previous: StateSnapshot = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      counts: {
        running: 1,
        waiting: 0,
        done: 0,
        idle: 0,
        error: 0,
      },
      sessions: [
        session({
          id: "codex:shared",
          status: "running",
          updatedAt: "2026-07-01T00:00:05.000Z",
          lastEventAt: "2026-07-01T00:00:05.000Z",
          runningSince: "2026-07-01T00:00:00.000Z",
        }),
      ],
    };
    const done = session({
      id: "codex:shared",
      status: "done",
      updatedAt: "2026-07-01T00:00:20.000Z",
      lastEventAt: "2026-07-01T00:00:20.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:20.000Z",
    });

    expect(applyDebounce(previous, [done])).toEqual([
      {
        ...done,
        pendingStatus: undefined,
        pendingCount: 0,
      },
    ]);
  });

  it("debounces passive done inferred without a fresher event", () => {
    const previous: StateSnapshot = {
      generatedAt: "2026-07-01T00:00:30.000Z",
      counts: {
        running: 1,
        waiting: 0,
        done: 0,
        idle: 0,
        error: 0,
      },
      sessions: [
        session({
          id: "codex:shared",
          status: "running",
          updatedAt: "2026-07-01T00:00:05.000Z",
          lastEventAt: "2026-07-01T00:00:05.000Z",
          runningSince: "2026-07-01T00:00:00.000Z",
        }),
      ],
    };
    const done = session({
      id: "codex:shared",
      status: "done",
      updatedAt: "2026-07-01T00:00:05.000Z",
      lastEventAt: "2026-07-01T00:00:05.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-01T00:00:05.000Z",
    });

    expect(applyDebounce(previous, [done])).toEqual([
      {
        ...done,
        status: "running",
        pendingStatus: "done",
        pendingCount: 1,
      },
    ]);
  });
});
