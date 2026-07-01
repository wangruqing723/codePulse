import { describe, expect, it } from "vitest";
import { parseMonitorProjectPrefixes, matchesMonitorPrefixes } from "./paths";
import {
  dedupeSessionsById,
  inferClaudeStatus,
  inferClaudeTurnStartAt,
  inferCodexStatus,
  inferCodexTurnStartAt,
} from "./scanners";
import { formatElapsed, toPositiveInt } from "./time";
import type { SessionRecord } from "./types";

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
});

describe("Codex status inference", () => {
  it("treats task_complete events as done", () => {
    expect(
      inferCodexStatus({ payload: { type: "task_complete" } }, 10_000, false),
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
