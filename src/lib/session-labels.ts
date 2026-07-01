import { formatElapsed, formatRelative } from "./time";
import type { SessionRecord } from "./types";

export function itemSubtitle(session: SessionRecord, now = Date.now()): string {
  if (session.status === "running") {
    return `已运行 ${formatElapsed(session.runningSince ?? session.lastEventAt, now)}`;
  }

  if (session.status === "done") {
    if (session.runningSince && session.completedAt) {
      return `用时 ${formatElapsed(session.runningSince, Date.parse(session.completedAt))} · ${formatRelative(session.completedAt, now)}完成`;
    }

    return `${formatRelative(session.completedAt ?? session.lastEventAt, now)}完成`;
  }

  if (session.status === "waiting") {
    const waitStartedAt = session.lastEventAt ?? session.updatedAt;
    if (session.runningSince) {
      return `已运行 ${formatElapsed(session.runningSince, now)} · 等待输入 ${formatElapsed(waitStartedAt, now)}`;
    }

    return `等待输入 ${formatElapsed(waitStartedAt, now)}`;
  }

  if (session.status === "error") {
    return session.errorMessage ?? "需要查看 transcript";
  }

  return formatRelative(session.lastEventAt, now);
}
