import { LaunchType, showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyTransitions } from "./notifications";
import type { SessionRecord, StateSnapshot } from "./types";

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

function snapshot(sessions: SessionRecord[]): StateSnapshot {
  return {
    generatedAt: "2026-07-01T00:00:00.000Z",
    sessions,
    counts: {
      running: sessions.filter((item) => item.status === "running").length,
      waiting: sessions.filter((item) => item.status === "waiting").length,
      done: sessions.filter((item) => item.status === "done").length,
      idle: sessions.filter((item) => item.status === "idle").length,
      error: sessions.filter((item) => item.status === "error").length,
    },
  };
}

describe("transition notifications", () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear();
  });

  it("skips toast when menu bar command refreshes in background", async () => {
    await notifyTransitions(
      snapshot([session({ status: "running" })]),
      snapshot([session({ status: "waiting" })]),
      LaunchType.Background,
    );

    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows toast for user-initiated launches", async () => {
    await notifyTransitions(
      snapshot([session({ status: "running" })]),
      snapshot([session({ status: "waiting" })]),
      LaunchType.UserInitiated,
    );

    expect(showToast).toHaveBeenCalledWith({
      style: "success",
      title: "轮到你了: project",
      message: "Claude Code",
    });
  });
});
