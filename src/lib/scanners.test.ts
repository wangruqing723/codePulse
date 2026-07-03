import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMonitorProjectPrefixes, matchesMonitorPrefixes } from "./paths";
import {
  dedupeSessionsById,
  filterClaudeTranscriptFiles,
  inferClaudeStatus,
  inferClaudeTurnStartAt,
  inferCodexStatus,
  inferCodexStatusFromEvents,
  inferCodexTurnStartAt,
  scanSessions,
} from "./scanners";
import { formatElapsed, toPositiveInt } from "./time";
import type { SessionRecord } from "./types";

async function writeJsonlFixture(
  filePath: string,
  lines: unknown[],
  mtimeMs: number,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  const mtime = new Date(mtimeMs);
  await utimes(filePath, mtime, mtime);
}

describe("preferences parsing", () => {
  it("falls back when numeric text is invalid", () => {
    expect(toPositiveInt("abc", 5)).toBe(5);
    expect(toPositiveInt("10", 5)).toBe(10);
  });
});

describe("project filters", () => {
  it("matches comma-separated cwd prefixes", () => {
    const prefixes = parseMonitorProjectPrefixes("~/docker,/tmp/demo");
    expect(matchesMonitorPrefixes("/tmp/demo/app", prefixes)).toBe(true);
    expect(matchesMonitorPrefixes("/var/other", prefixes)).toBe(false);
  });
});

describe("time formatting", () => {
  it("formats elapsed runtime", () => {
    expect(
      formatElapsed(
        "2026-07-01T00:00:00.000Z",
        Date.parse("2026-07-01T00:01:05.000Z"),
      ),
    ).toBe("1m5s");
  });
});

describe("Claude status inference", () => {
  it("ignores Claude subagent transcripts", () => {
    expect(
      filterClaudeTranscriptFiles([
        "/Users/me/.claude/projects/-tmp-project/session.jsonl",
        "/Users/me/.claude/projects/-tmp-project/session/subagents/agent-1.jsonl",
        "/Users/me/.claude/projects/-tmp-project/session/subagents/agent-2.jsonl",
      ]),
    ).toEqual(["/Users/me/.claude/projects/-tmp-project/session.jsonl"]);
  });

  it("treats fresh tool_use assistant messages as running", () => {
    expect(
      inferClaudeStatus(
        { type: "assistant", message: { stop_reason: "tool_use" } },
        10_000,
        false,
      ),
    ).toBe("running");
  });

  it("treats end_turn assistant messages as done", () => {
    expect(
      inferClaudeStatus(
        { type: "assistant", message: { stop_reason: "end_turn" } },
        10_000,
        false,
      ),
    ).toBe("done");
  });

  it("treats Claude user interruption markers as done", () => {
    expect(
      inferClaudeStatus(
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: "[Request interrupted by user]" }],
          },
        },
        10_000,
        false,
      ),
    ).toBe("done");
  });

  it("prioritizes error status", () => {
    expect(inferClaudeStatus({ type: "assistant" }, 10_000, true)).toBe(
      "error",
    );
  });

  it("uses the latest user event as the turn start", () => {
    expect(
      inferClaudeTurnStartAt([
        { type: "user", timestamp: "2026-07-01T00:00:00.000Z" },
        { type: "assistant", timestamp: "2026-07-01T00:00:10.000Z" },
        { type: "user", timestamp: "2026-07-01T00:01:00.000Z" },
        { type: "assistant", timestamp: "2026-07-01T00:01:30.000Z" },
      ]),
    ).toBe("2026-07-01T00:01:00.000Z");
  });

  it("does not use Claude interruption markers as turn starts", () => {
    expect(
      inferClaudeTurnStartAt([
        { type: "user", timestamp: "2026-07-01T00:00:00.000Z" },
        {
          type: "user",
          timestamp: "2026-07-01T00:00:30.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "[Request interrupted by user]" }],
          },
        },
      ]),
    ).toBe("2026-07-01T00:00:00.000Z");
  });

  it("does not use Claude tool results as turn starts", () => {
    expect(
      inferClaudeTurnStartAt([
        {
          type: "user",
          timestamp: "2026-07-01T00:00:00.000Z",
          origin: { kind: "human" },
          promptSource: "typed",
          message: { role: "user", content: "run the task" },
        },
        {
          type: "assistant",
          timestamp: "2026-07-01T00:00:05.000Z",
          message: { stop_reason: "tool_use" },
        },
        {
          type: "user",
          timestamp: "2026-07-01T00:00:40.000Z",
          sourceToolAssistantUUID: "assistant-uuid",
          toolUseResult: { stdout: "approved and completed" },
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_123",
                type: "tool_result",
                content: "approved and completed",
              },
            ],
          },
        },
      ]),
    ).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("Codex status inference", () => {
  it("treats task_complete events as done", () => {
    expect(
      inferCodexStatus({ payload: { type: "task_complete" } }, 10_000, false),
    ).toBe("done");
  });

  it("treats escalated Codex command calls as waiting", () => {
    expect(
      inferCodexStatus(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: JSON.stringify({
              sandbox_permissions: "require_escalated",
            }),
          },
        },
        120_000,
        false,
      ),
    ).toBe("waiting");
  });

  it("keeps Codex approval calls waiting when token_count follows", () => {
    expect(
      inferCodexStatusFromEvents(
        [
          {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "exec_command",
              call_id: "call_approval",
              arguments: JSON.stringify({
                sandbox_permissions: "require_escalated",
              }),
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "token_count",
            },
          },
        ],
        120_000,
        false,
      ),
    ).toBe("waiting");
  });

  it("clears Codex approval waiting after the matching output arrives", () => {
    expect(
      inferCodexStatusFromEvents(
        [
          {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "exec_command",
              call_id: "call_approval",
              arguments: JSON.stringify({
                sandbox_permissions: "require_escalated",
              }),
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "token_count",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "call_approval",
            },
          },
        ],
        120_000,
        false,
      ),
    ).toBe("done");
  });

  it("clears Codex approval waiting after the turn completes", () => {
    expect(
      inferCodexStatusFromEvents(
        [
          {
            type: "response_item",
            payload: {
              type: "function_call",
              name: "exec_command",
              call_id: "call_approval",
              arguments: JSON.stringify({
                sandbox_permissions: "require_escalated",
              }),
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "token_count",
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "task_complete",
            },
          },
        ],
        120_000,
        false,
      ),
    ).toBe("done");
  });

  it("treats Codex user input requests as waiting", () => {
    expect(
      inferCodexStatus(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "request_user_input",
          },
        },
        120_000,
        false,
      ),
    ).toBe("waiting");
  });

  it("treats aborted Codex turns as done", () => {
    expect(
      inferCodexStatus(
        { type: "event_msg", payload: { type: "turn_aborted" } },
        10_000,
        false,
      ),
    ).toBe("done");
  });

  it("treats fresh response events as running", () => {
    expect(
      inferCodexStatus(
        { type: "response_item", payload: { type: "agent_message" } },
        10_000,
        false,
      ),
    ).toBe("running");
  });

  it("prioritizes error status", () => {
    expect(inferCodexStatus({ type: "event_msg" }, 10_000, true)).toBe("error");
  });

  it("uses the latest user turn event as the turn start", () => {
    expect(
      inferCodexTurnStartAt([
        {
          type: "event_msg",
          timestamp: "2026-07-01T00:00:00.000Z",
          payload: { type: "task_started" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-01T00:00:01.000Z",
          payload: { type: "user_message" },
        },
        {
          type: "response_item",
          timestamp: "2026-07-01T00:00:20.000Z",
          payload: { type: "agent_message" },
        },
      ]),
    ).toBe("2026-07-01T00:00:01.000Z");
  });

  it("uses the latest Codex turn start across multiple turns", () => {
    expect(
      inferCodexTurnStartAt([
        {
          type: "event_msg",
          timestamp: "2026-07-01T00:00:00.000Z",
          payload: { type: "user_message" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-01T00:03:00.000Z",
          payload: { type: "task_complete" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-01T00:05:00.000Z",
          payload: { type: "user_message" },
        },
        {
          type: "response_item",
          timestamp: "2026-07-01T00:07:30.000Z",
          payload: { type: "agent_message" },
        },
      ]),
    ).toBe("2026-07-01T00:05:00.000Z");
  });
});

describe("session de-duplication", () => {
  function session(
    patch: Pick<SessionRecord, "id" | "updatedAt" | "runningSince"> &
      Partial<SessionRecord>,
  ): SessionRecord {
    return {
      agent: "codex",
      status: "done",
      source: "passive",
      projectName: "codePulse",
      title: "codePulse",
      completedAt: patch.updatedAt,
      lastEventAt: patch.updatedAt,
      ...patch,
    };
  }

  it("keeps the freshest transcript when Codex writes duplicate session ids", () => {
    const staleShortTranscript = session({
      id: "codex:shared-session",
      updatedAt: "2026-07-01T14:10:51.823Z",
      runningSince: "2026-07-01T14:10:20.420Z",
      transcriptPath: "/tmp/short.jsonl",
    });
    const freshFullTranscript = session({
      id: "codex:shared-session",
      updatedAt: "2026-07-01T14:11:31.061Z",
      runningSince: "2026-07-01T14:06:34.643Z",
      transcriptPath: "/tmp/full.jsonl",
    });

    expect(
      dedupeSessionsById([freshFullTranscript, staleShortTranscript]),
    ).toEqual([freshFullTranscript]);
    expect(
      dedupeSessionsById([staleShortTranscript, freshFullTranscript]),
    ).toEqual([freshFullTranscript]);
  });
});

describe("configurable scan roots", () => {
  it("reads Claude and Codex transcripts from injected roots", async () => {
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "codepulse-scan-"));
    const claudeProjectsRoot = path.join(tmpRoot, "claude-projects");
    const codexSessionsRoot = path.join(tmpRoot, "codex-sessions");
    const now = Date.parse("2026-07-03T12:00:00.000Z");
    const cwd = "/home/task-1/project/app";

    await writeJsonlFixture(
      path.join(
        claudeProjectsRoot,
        "-home-task-1-project-app",
        "session.jsonl",
      ),
      [
        {
          type: "user",
          timestamp: "2026-07-03T11:59:40.000Z",
          cwd,
          sessionId: "claude-session",
        },
        {
          type: "assistant",
          timestamp: "2026-07-03T11:59:50.000Z",
          message: { stop_reason: "tool_use" },
        },
      ],
      now - 1_000,
    );
    await writeJsonlFixture(
      path.join(codexSessionsRoot, "2026", "07", "03", "codex-session.jsonl"),
      [
        {
          type: "session_meta",
          payload: { cwd, session_id: "codex-session" },
        },
        {
          type: "event_msg",
          timestamp: "2026-07-03T11:59:41.000Z",
          payload: { type: "user_message" },
        },
        {
          type: "response_item",
          timestamp: "2026-07-03T11:59:55.000Z",
          payload: { type: "agent_message" },
        },
      ],
      now - 1_000,
    );

    const sessions = await scanSessions({
      activeWindowMs: 5 * 60 * 1000,
      monitorPrefixes: ["/home/task-1/project"],
      now,
      roots: {
        claudeProjectsRoot,
        codexSessionsRoot,
      },
    } as never);

    expect(sessions).toHaveLength(2);
    expect(
      sessions.map((session) => ({
        agent: session.agent,
        cwd: session.cwd,
      })),
    ).toEqual([
      { agent: "claude", cwd },
      { agent: "codex", cwd },
    ]);
  });
});
