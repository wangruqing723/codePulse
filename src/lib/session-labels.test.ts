import { describe, expect, it } from "vitest";
import * as sessionLabels from "./session-labels";
import { itemSubtitle } from "./session-labels";
import type { SessionRecord } from "./types";

function session(patch: Partial<SessionRecord>): SessionRecord {
  return {
    id: "claude:shared",
    agent: "claude",
    status: "running",
    source: "passive",
    cwd: "/tmp/project",
    projectName: "project",
    title: "project",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastEventAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

describe("session labels", () => {
  it("separates delegated sessions and labels their origin", () => {
    const helpers = sessionLabels as unknown as {
      partitionSessionsByOrigin?: (sessions: SessionRecord[]) => {
        userSessions: SessionRecord[];
        delegatedSessions: SessionRecord[];
      };
      sessionAgentLabel?: (session: SessionRecord) => string;
    };
    const userSession = session({ id: "codex:user", agent: "codex" });
    const delegatedSession = session({
      id: "codex:delegated",
      agent: "codex",
      origin: "delegated",
    } as Partial<SessionRecord>);

    expect(
      helpers.partitionSessionsByOrigin?.([userSession, delegatedSession]),
    ).toEqual({
      userSessions: [userSession],
      delegatedSessions: [delegatedSession],
    });
    expect(helpers.sessionAgentLabel?.(userSession)).toBe("Codex");
    expect(helpers.sessionAgentLabel?.(delegatedSession)).toBe(
      "Codex（Claude Code 委托）",
    );
  });

  it("keeps total elapsed time moving while waiting for input", () => {
    expect(
      itemSubtitle(
        session({
          status: "waiting",
          runningSince: "2026-07-01T00:00:00.000Z",
          lastEventAt: "2026-07-01T00:02:00.000Z",
        }),
        Date.parse("2026-07-01T00:03:30.000Z"),
      ),
    ).toBe("已运行 3m30s · 等待输入 1m30s");
  });

  it("shows wait duration when turn start is unavailable", () => {
    expect(
      itemSubtitle(
        session({
          status: "waiting",
          lastEventAt: "2026-07-01T00:02:00.000Z",
        }),
        Date.parse("2026-07-01T00:02:45.000Z"),
      ),
    ).toBe("等待输入 45s");
  });
});
