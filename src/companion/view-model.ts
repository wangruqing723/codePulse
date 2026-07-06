import { toWslUncPath } from "../lib/wsl";
import {
  AGENT_LABEL,
  STATUS_LABEL,
  STATUS_ICON,
  type SessionRecord,
  type SessionStatus,
  type StateSnapshot,
} from "../lib/types";

export type CompanionPlatform = "darwin" | "win32";
export type DisplaySessionStatus = "running" | "done" | "error" | "waiting";
export type StatusTone = "green" | "blue" | "red" | "yellow";

export interface FloatingViewModelContext {
  platform: CompanionPlatform;
  unavailableReason?: string;
  wslDistro?: string;
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

export type FloatingStatus = SessionStatus | "unavailable" | "empty";

export interface FloatingViewModel {
  status: FloatingStatus;
  count: number;
  text: string;
  summaryText?: string;
  unavailableReason?: string;
  sessions: FloatingSessionViewModel[];
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

function dominantStatus(snapshot: StateSnapshot | undefined): FloatingStatus {
  const counts = snapshot?.counts;
  if (!counts) {
    return "empty";
  }

  for (const status of DISPLAY_STATUS_ORDER) {
    if ((counts[status] ?? 0) > 0) {
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

  return snapshot?.counts[status] ?? 0;
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

  if (model.status === "empty") {
    return "暂无活跃会话";
  }

  const summaries = DISPLAY_STATUS_ORDER.flatMap((status) => {
    const count = model.sessions.filter(
      (session) => session.displayStatus === status,
    ).length;

    return count > 0
      ? [`${STATUS_ICON[status]} ${count} ${SUMMARY_LABEL[status]}`]
      : [];
  });

  return summaries.length > 0
    ? summaries.join("  ")
    : `${STATUS_LABEL[model.status]} ${model.count} 个`;
}

function displayStatusFor(
  session: SessionRecord,
): DisplaySessionStatus | undefined {
  return session.status === "idle" ? undefined : session.status;
}

function formatDurationText(start: string | undefined, now: Date): string {
  const startDate = start ? new Date(start) : undefined;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return "00:00";
  }

  const totalSeconds = Math.max(
    0,
    Math.floor((now.getTime() - startDate.getTime()) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function displayPathFor(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  const homeMatch = path.match(/^\/Users\/[^/]+\/(.+)$/);
  if (!homeMatch) {
    return path;
  }

  const homeRelativeSegments = homeMatch[1]?.split("/").filter(Boolean) ?? [];
  if (homeRelativeSegments.length <= 3) {
    return `~/${homeRelativeSegments.join("/")}`;
  }

  return `~/.../${homeRelativeSegments.slice(-2).join("/")}`;
}

function sessionContextText(session: SessionRecord): string {
  if (session.errorMessage) {
    return session.errorMessage;
  }

  if (session.title) {
    return session.title;
  }

  return AGENT_LABEL[session.agent];
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
        durationText: formatDurationText(session.updatedAt, now),
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
    text: "",
    summaryText: "",
    unavailableReason: context.unavailableReason,
    sessions,
  };

  const text = statusText(model);

  return {
    ...model,
    text,
    summaryText: text,
  };
}
