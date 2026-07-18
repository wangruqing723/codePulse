import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as stateModule from "./state";
import { applyDebounce, buildState, mergeHookEvents } from "./state";
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

  it("clears a running session when a SessionEnd done hook arrives", () => {
    const passiveRunning = session({
      id: "claude:shared",
      agent: "claude",
      status: "running",
      updatedAt: "2026-07-01T00:00:20.000Z",
      lastEventAt: "2026-07-01T00:00:20.000Z",
      runningSince: "2026-07-01T00:00:10.000Z",
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "session-end",
          agent: "claude",
          kind: "done",
          sessionId: "shared",
          eventName: "SessionEnd",
          timestamp: "2026-07-01T00:00:40.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:45.000Z"),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "claude:shared",
      status: "done",
      completedAt: "2026-07-01T00:00:40.000Z",
    });
  });

  it("clears a running session from a SessionEnd hook matched only by cwd", () => {
    const passiveRunning = session({
      id: "claude:shared",
      agent: "claude",
      status: "running",
      cwd: "/tmp/project",
      updatedAt: "2026-07-01T00:00:20.000Z",
      lastEventAt: "2026-07-01T00:00:20.000Z",
      runningSince: "2026-07-01T00:00:10.000Z",
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "session-end",
          agent: "claude",
          kind: "done",
          cwd: "/tmp/project",
          eventName: "SessionEnd",
          timestamp: "2026-07-01T00:00:40.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:45.000Z"),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "claude:shared",
      status: "done",
    });
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

  it("merges Codex transcript hooks that were mislabeled as Claude", () => {
    const transcriptPath =
      "/Users/test/.codex/sessions/2026/07/10/rollout-shared.jsonl";
    const passiveRunning = session({
      id: "codex:shared",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:00:10.000Z",
      lastEventAt: "2026-07-01T00:00:10.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath,
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "mislabeled-prompt",
          agent: "claude",
          eventName: "UserPromptSubmit",
          sessionId: "shared",
          transcriptPath,
          timestamp: "2026-07-01T00:00:20.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:21.000Z"),
    );

    expect(sessions).toEqual([
      {
        ...passiveRunning,
        source: "hook",
        updatedAt: "2026-07-01T00:00:20.000Z",
        lastEventAt: "2026-07-01T00:00:20.000Z",
      },
    ]);
  });

  it("merges mislabeled Claude Stop hooks into the Codex session", () => {
    const transcriptPath =
      "/Users/test/.codex/sessions/2026/07/10/rollout-shared.jsonl";
    const passiveRunning = session({
      id: "codex:shared",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:00:10.000Z",
      lastEventAt: "2026-07-01T00:00:10.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath,
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "mislabeled-stop",
          agent: "claude",
          kind: "done",
          eventName: "Stop",
          sessionId: "shared",
          transcriptPath,
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

  it("does not let a normalized Codex subagent Stop overwrite its parent session", () => {
    const parentSession = session({
      id: "codex:parent",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:00:10.000Z",
      lastEventAt: "2026-07-01T00:00:10.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath:
        "/Users/test/.codex/sessions/2026/07/10/rollout-parent.jsonl",
    });
    const sessions = mergeHookEvents(
      [parentSession],
      [
        hook({
          id: "subagent-stop",
          agent: "claude",
          kind: "done",
          eventName: "Stop",
          sessionId: "parent",
          transcriptPath:
            "/Users/test/.codex/sessions/2026/07/10/rollout-subagent.jsonl",
          timestamp: "2026-07-01T00:00:20.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:21.000Z"),
    );

    expect(sessions).toEqual([parentSession]);
  });

  it("merges WSL Linux and UNC transcript paths for the same session id", () => {
    const hookTranscriptPath = "/home/test/.codex/sessions/rollout.jsonl";
    const passiveRunning = session({
      id: "codex:wsl-session",
      agent: "codex",
      status: "running",
      updatedAt: "2026-07-01T00:00:10.000Z",
      lastEventAt: "2026-07-01T00:00:10.000Z",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath:
        "\\\\wsl$\\Ubuntu\\home\\test\\.codex\\sessions\\rollout.jsonl",
    });
    const sessions = mergeHookEvents(
      [passiveRunning],
      [
        hook({
          id: "wsl-stop",
          agent: "claude",
          kind: "done",
          eventName: "Stop",
          sessionId: "wsl-session",
          transcriptPath: hookTranscriptPath,
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
        transcriptPath: hookTranscriptPath,
        updatedAt: "2026-07-01T00:00:20.000Z",
        lastEventAt: "2026-07-01T00:00:20.000Z",
        completedAt: "2026-07-01T00:00:20.000Z",
      },
    ]);
  });

  it("recognizes WSL Codex transcript paths in hook-only events", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "mislabeled-wsl-prompt",
          agent: "claude",
          eventName: "UserPromptSubmit",
          sessionId: "wsl-session",
          cwd: "/home/test/project",
          transcriptPath:
            "\\\\wsl$\\Ubuntu\\home\\test\\.codex\\sessions\\2026\\07\\10\\rollout-wsl-session.jsonl",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:01.000Z"),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "codex:wsl-session",
        agent: "codex",
        source: "hook",
        status: "running",
      }),
    ]);
  });

  it("does not treat similar directory names as Codex transcript roots", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "similar-path",
          agent: "claude",
          eventName: "UserPromptSubmit",
          sessionId: "claude-session",
          transcriptPath: "/tmp/.codex/sessions-copy/claude-session.jsonl",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:01.000Z"),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "claude:claude-session",
        agent: "claude",
      }),
    ]);
  });

  it("updates the Codex session when both agents reuse the same session id", () => {
    const claudeSession = session({
      id: "claude:shared",
      agent: "claude",
      status: "done",
      transcriptPath: "/Users/test/.claude/projects/project/shared.jsonl",
    });
    const codexSession = session({
      id: "codex:shared",
      agent: "codex",
      status: "running",
      runningSince: "2026-07-01T00:00:00.000Z",
      transcriptPath:
        "/Users/test/.codex/sessions/2026/07/10/rollout-shared.jsonl",
    });
    const sessions = mergeHookEvents(
      [claudeSession, codexSession],
      [
        hook({
          id: "mislabeled-codex-prompt",
          agent: "claude",
          eventName: "UserPromptSubmit",
          sessionId: "shared",
          transcriptPath: codexSession.transcriptPath,
          timestamp: "2026-07-01T00:00:40.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:41.000Z"),
    );

    expect(sessions).toEqual([
      claudeSession,
      {
        ...codexSession,
        source: "hook",
        updatedAt: "2026-07-01T00:00:40.000Z",
        lastEventAt: "2026-07-01T00:00:40.000Z",
      },
    ]);
  });

  it("recognizes Claude transcript paths in mislabeled hook events", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "mislabeled-claude-prompt",
          agent: "codex",
          eventName: "UserPromptSubmit",
          sessionId: "claude-session",
          transcriptPath:
            "/Users/test/.claude/projects/-Users-test-project/claude-session.jsonl",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:01.000Z"),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: "claude:claude-session",
        agent: "claude",
        source: "hook",
        status: "running",
      }),
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

  it("preserves running start time when Claude resumes after waiting", () => {
    const sessions = mergeHookEvents(
      [],
      [
        hook({
          id: "prompt",
          eventName: "UserPromptSubmit",
          sessionId: "claude-session",
          timestamp: "2026-07-01T00:00:00.000Z",
        }),
        hook({
          id: "permission",
          kind: "waiting",
          eventName: "Notification",
          sessionId: "claude-session",
          timestamp: "2026-07-01T00:00:10.000Z",
        }),
        hook({
          id: "resume",
          eventName: "UserPromptSubmit",
          sessionId: "claude-session",
          timestamp: "2026-07-01T00:00:20.000Z",
        }),
      ],
      [],
      Date.parse("2026-07-01T00:00:21.000Z"),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "claude:claude-session",
      status: "running",
      runningSince: "2026-07-01T00:00:00.000Z",
      lastEventAt: "2026-07-01T00:00:20.000Z",
    });
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

  it("preserves previous runtime when passive state resumes from waiting", () => {
    const previous: StateSnapshot = {
      generatedAt: "2026-07-01T00:00:10.000Z",
      counts: {
        running: 0,
        waiting: 1,
        done: 0,
        idle: 0,
        error: 0,
      },
      sessions: [
        session({
          id: "claude:shared",
          agent: "claude",
          status: "waiting",
          updatedAt: "2026-07-01T00:00:10.000Z",
          lastEventAt: "2026-07-01T00:00:10.000Z",
          runningSince: "2026-07-01T00:00:00.000Z",
        }),
      ],
    };
    const running = session({
      id: "claude:shared",
      agent: "claude",
      status: "running",
      updatedAt: "2026-07-01T00:00:40.000Z",
      lastEventAt: "2026-07-01T00:00:40.000Z",
    });

    expect(applyDebounce(previous, [running])).toEqual([
      {
        ...running,
        runningSince: "2026-07-01T00:00:00.000Z",
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

describe("configurable state roots", () => {
  it("builds state from injected roots and writes state.json under stateRoot", async () => {
    const buildStateFromConfig = (
      stateModule as {
        buildStateFromConfig?: (config: {
          stateRoot: string;
          eventRoot: string;
          scanRoots: {
            claudeProjectsRoot: string;
            codexSessionsRoot: string;
          };
          preferences: {
            activeWindowMinutes: string;
            monitorProjects: string;
          };
          now: number;
        }) => Promise<{ snapshot: StateSnapshot }>;
      }
    ).buildStateFromConfig;
    expect(buildStateFromConfig).toBeTypeOf("function");
    if (!buildStateFromConfig) {
      return;
    }

    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "codepulse-state-"));
    const stateRoot = path.join(tmpRoot, "state-root");
    const eventRoot = path.join(tmpRoot, "event-root");
    const scanRoot = path.join(tmpRoot, "scan-root");
    const cwd = "/home/task-1/project/app";
    const now = Date.parse("2026-07-03T12:00:00.000Z");
    const timestamp = new Date(now).toISOString();

    await mkdir(eventRoot, { recursive: true });
    await mkdir(scanRoot, { recursive: true });
    await writeFile(
      path.join(eventRoot, "event.json"),
      `${JSON.stringify({
        id: "hook-1",
        agent: "claude",
        kind: "running",
        timestamp,
        sessionId: "claude-session",
        cwd,
      })}\n`,
    );

    const { snapshot } = await buildStateFromConfig({
      stateRoot,
      eventRoot,
      scanRoots: {
        claudeProjectsRoot: path.join(scanRoot, "claude"),
        codexSessionsRoot: path.join(scanRoot, "codex"),
      },
      preferences: {
        activeWindowMinutes: "5",
        monitorProjects: "/home/task-1/project",
      },
      now,
    });

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      id: "claude:claude-session",
      cwd,
      source: "hook",
      status: "running",
    });
    expect(
      JSON.parse(await readFile(path.join(stateRoot, "state.json"), "utf8")),
    ).toMatchObject({
      sessions: [
        expect.objectContaining({
          id: "claude:claude-session",
          cwd,
        }),
      ],
    });
  });

  it("keeps buildState using supportPath events by default", async () => {
    const supportPath = await mkdtemp(
      path.join(os.tmpdir(), "codepulse-raycast-"),
    );
    const cwd = "/tmp/codepulse-default-event-path";
    const eventRoot = path.join(supportPath, "events");
    const timestamp = new Date().toISOString();

    await mkdir(eventRoot, { recursive: true });
    await writeFile(
      path.join(eventRoot, "event.json"),
      `${JSON.stringify({
        id: "hook-compat",
        agent: "claude",
        kind: "running",
        timestamp,
        sessionId: "claude-session",
        cwd,
      })}\n`,
    );

    const { snapshot } = await buildState(supportPath, {
      activeWindowMinutes: "5",
      monitorProjects: "/tmp/codepulse-default-event-path",
    });

    expect(snapshot.sessions).toEqual([
      expect.objectContaining({
        id: "claude:claude-session",
        cwd,
        source: "hook",
      }),
    ]);
  });
});
