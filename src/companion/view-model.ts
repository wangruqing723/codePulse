import { toWslUncPath } from "../lib/wsl";
import { isDelegatedSession } from "../lib/session-labels";
import {
  STATUS_LABEL,
  STATUS_ICON,
  type SessionRecord,
  type SessionStatus,
  type StateSnapshot,
} from "../lib/types";

export type CompanionPlatform = "darwin" | "win32";
export type DisplaySessionStatus = "running" | "done" | "error" | "waiting";
export type StatusTone = "green" | "blue" | "red" | "yellow";
export type CompanionPresentation = "badge" | "panel";

export interface FloatingViewModelContext {
  platform: CompanionPlatform;
  unavailableReason?: string;
  wslDistro?: string;
  isPinned?: boolean;
  now?: Date;
}

export interface SessionCopyAction {
  id: "copy-local-path" | "copy-wsl-path" | "copy-unc-path";
  label: string;
  value: string;
}

export interface FloatingSessionViewModel {
  session: SessionRecord;
  displayStatus?: DisplaySessionStatus;
  statusTone?: StatusTone;
  contextText?: string;
  durationText?: string;
  displayPath?: string;
  fullPath?: string;
  copyAction?: SessionCopyAction;
  copyActions: SessionCopyAction[];
}

export interface FloatingStatusSummaryItem {
  status: DisplaySessionStatus;
  statusTone: StatusTone;
  count: number;
  label: string;
}

export type FloatingStatus = SessionStatus | "unavailable" | "empty";

export interface FloatingBadgeViewModel {
  tone: StatusTone;
  status: FloatingStatus;
  totalCount: number;
  label: string;
}

export interface FloatingViewModel {
  status: FloatingStatus;
  count: number;
  isPinned?: boolean;
  text: string;
  summaryText?: string;
  summaryItems?: FloatingStatusSummaryItem[];
  unavailableReason?: string;
  sessions: FloatingSessionViewModel[];
  presentation?: CompanionPresentation;
  badge?: FloatingBadgeViewModel;
}

const DISPLAY_STATUS_ORDER: DisplaySessionStatus[] = [
  "error",
  "waiting",
  "running",
  "done",
];

const STATUS_TONE: Record<DisplaySessionStatus, StatusTone> = {
  running: "green",
  done: "blue",
  error: "red",
  waiting: "yellow",
};

const SUMMARY_LABEL: Record<DisplaySessionStatus, string> = {
  running: "运行中",
  done: "完成",
  error: "错误",
  waiting: "等待",
};

const DELEGATED_SUMMARY_LABEL: Record<DisplaySessionStatus, string> = {
  running: "委托中",
  done: "委托完成",
  error: "委托出错",
  waiting: "委托待确认",
};

function dominantStatus(
  snapshot: StateSnapshot | undefined,
): DisplaySessionStatus | "empty" {
  const sessions = snapshot?.sessions ?? [];
  if (sessions.length === 0) {
    return "empty";
  }

  for (const status of DISPLAY_STATUS_ORDER) {
    if (sessions.some((session) => session.status === status)) {
      return status;
    }
  }

  return "empty";
}

function statusCount(
  snapshot: StateSnapshot | undefined,
  status: FloatingStatus,
): number {
  if (status === "unavailable" || status === "empty") {
    return 0;
  }

  return (
    snapshot?.sessions.filter((session) => session.status === status).length ??
    0
  );
}

export function buildBadgeViewModel(
  snapshot: StateSnapshot | undefined,
  context: FloatingViewModelContext,
): FloatingBadgeViewModel {
  const status =
    context.unavailableReason && context.platform === "win32"
      ? "unavailable"
      : dominantStatus(snapshot);
  const totalCount =
    snapshot?.sessions.filter((session) => session.status !== "idle").length ??
    0;

  return {
    status,
    tone:
      status === "empty"
        ? STATUS_TONE.done
        : status === "unavailable"
          ? STATUS_TONE.error
          : STATUS_TONE[status],
    totalCount,
    label: `${totalCount} 个活跃会话`,
  };
}

export function sessionCopyActions(
  session: SessionRecord,
  context: FloatingViewModelContext,
): SessionCopyAction[] {
  if (!session.cwd) {
    return [];
  }

  if (context.platform === "darwin") {
    return [
      {
        id: "copy-local-path",
        label: "复制路径",
        value: session.cwd,
      },
    ];
  }

  const uncPath = context.wslDistro
    ? toWslUncPath(context.wslDistro, session.cwd)
    : undefined;

  return [
    {
      id: uncPath ? "copy-unc-path" : "copy-wsl-path",
      label: "复制路径",
      value: uncPath ?? session.cwd,
    },
  ];
}

export function statusText(model: FloatingViewModel): string {
  if (model.status === "unavailable") {
    return "WSL 不可用";
  }

  const summaries = model.summaryItems?.map(
    (item) => `${STATUS_ICON[item.status]} ${item.count} ${item.label}`,
  );

  if (summaries && summaries.length > 0) {
    return summaries.join("  ");
  }

  if (model.status === "empty") {
    return "暂无活跃会话";
  }

  return `${STATUS_LABEL[model.status]} ${model.count} 个`;
}

function statusSummaryItems(
  sessions: FloatingSessionViewModel[],
): FloatingStatusSummaryItem[] {
  const userSessions = sessions.filter(
    (session) => !isDelegatedSession(session.session),
  );
  const delegatedSessions = sessions.filter((session) =>
    isDelegatedSession(session.session),
  );

  return DISPLAY_STATUS_ORDER.flatMap((status) => {
    const items: FloatingStatusSummaryItem[] = [];
    const userCount = userSessions.filter(
      (session) => session.displayStatus === status,
    ).length;
    const delegatedCount = delegatedSessions.filter(
      (session) => session.displayStatus === status,
    ).length;

    if (userCount > 0) {
      items.push({
        status,
        statusTone: STATUS_TONE[status],
        count: userCount,
        label: SUMMARY_LABEL[status],
      });
    }

    if (delegatedCount > 0) {
      items.push({
        status,
        statusTone: STATUS_TONE[status],
        count: delegatedCount,
        label: DELEGATED_SUMMARY_LABEL[status],
      });
    }

    return items;
  });
}

function displayStatusFor(
  session: SessionRecord,
): DisplaySessionStatus | undefined {
  return session.status === "idle" ? undefined : session.status;
}

function formatDurationText(
  start: string | undefined,
  end: Date | string,
): string {
  const startDate = start ? new Date(start) : undefined;
  const endDate = end instanceof Date ? end : new Date(end);
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return "00:00";
  }
  if (Number.isNaN(endDate.getTime())) {
    return "00:00";
  }

  const totalSeconds = Math.max(
    0,
    Math.floor((endDate.getTime() - startDate.getTime()) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function sessionDurationText(session: SessionRecord, now: Date): string {
  if (session.status === "done") {
    return formatDurationText(
      session.runningSince ?? session.updatedAt,
      session.completedAt ?? now,
    );
  }

  if (session.status === "error") {
    return formatDurationText(
      session.runningSince ?? session.updatedAt,
      session.completedAt ?? now,
    );
  }

  return formatDurationText(
    session.runningSince ?? session.lastEventAt ?? session.updatedAt,
    now,
  );
}

function displayPathFor(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  const homeMatch = path.match(/^\/Users\/[^/]+\/(.+)$/);
  if (homeMatch) {
    const homeRelativeSegments = homeMatch[1]?.split("/").filter(Boolean) ?? [];
    if (homeRelativeSegments.length <= 3) {
      return `~/${homeRelativeSegments.join("/")}`;
    }

    return `~/.../${homeRelativeSegments.slice(-2).join("/")}`;
  }

  if (!path.startsWith("/")) {
    return path;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 5) {
    return path;
  }

  return `/${segments.slice(0, 2).join("/")}/.../${segments
    .slice(-2)
    .join("/")}`;
}

function sessionContextText(session: SessionRecord): string | undefined {
  if (session.status === "waiting") {
    return "等待用户确认";
  }

  if (session.errorMessage) {
    return session.errorMessage;
  }

  return undefined;
}

export function buildFloatingViewModel(
  snapshot: StateSnapshot | undefined,
  context: FloatingViewModelContext,
): FloatingViewModel {
  const status =
    context.unavailableReason && context.platform === "win32"
      ? "unavailable"
      : dominantStatus(snapshot);
  const count = statusCount(snapshot, status);
  const now = new Date(context.now ?? snapshot?.generatedAt ?? Date.now());
  const sessions = (snapshot?.sessions ?? []).flatMap((session) => {
    const displayStatus = displayStatusFor(session);
    if (!displayStatus) {
      return [];
    }

    const copyActions = sessionCopyActions(session, context);

    return [
      {
        session,
        displayStatus,
        statusTone: STATUS_TONE[displayStatus],
        contextText: sessionContextText(session),
        durationText: sessionDurationText(session, now),
        displayPath: displayPathFor(session.cwd),
        fullPath: session.cwd,
        copyAction: copyActions[0],
        copyActions,
      },
    ];
  });

  const model: FloatingViewModel = {
    status,
    count,
    isPinned: context.isPinned,
    text: "",
    summaryText: "",
    summaryItems: statusSummaryItems(sessions),
    unavailableReason: context.unavailableReason,
    sessions,
    badge: buildBadgeViewModel(snapshot, context),
  };

  const text = statusText(model);

  return {
    ...model,
    text,
    summaryText: text,
  };
}
