import { describe, expect, it } from "vitest";
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
