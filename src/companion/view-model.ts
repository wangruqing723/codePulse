import { toWslUncPath } from "../lib/wsl";
import { STATUS_LABEL, type SessionRecord, type SessionStatus, type StateSnapshot } from "../lib/types";

export type CompanionPlatform = "darwin" | "win32";

export interface FloatingViewModelContext {
  platform: CompanionPlatform;
  unavailableReason?: string;
  wslDistro?: string;
}

export interface SessionCopyAction {
  id: "copy-local-path" | "copy-wsl-path" | "copy-unc-path";
  label: string;
  value: string;
}

export interface FloatingSessionViewModel {
  session: SessionRecord;
  copyActions: SessionCopyAction[];
}

export type FloatingStatus =
  | SessionStatus
  | "unavailable"
  | "empty";

export interface FloatingViewModel {
  status: FloatingStatus;
  count: number;
  text: string;
  unavailableReason?: string;
  sessions: FloatingSessionViewModel[];
}

const DOMINANT_STATUS_ORDER: SessionStatus[] = [
  "waiting",
  "error",
  "running",
  "done",
  "idle",
];

function dominantStatus(snapshot: StateSnapshot | undefined): FloatingStatus {
  const counts = snapshot?.counts;
  if (!counts) {
    return "empty";
  }

  for (const status of DOMINANT_STATUS_ORDER) {
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

  const actions: SessionCopyAction[] = [
    {
      id: "copy-wsl-path",
      label: "复制 WSL 路径",
      value: session.cwd,
    },
  ];

  const uncPath = context.wslDistro
    ? toWslUncPath(context.wslDistro, session.cwd)
    : undefined;
  if (uncPath) {
    actions.push({
      id: "copy-unc-path",
      label: "复制 Windows 路径",
      value: uncPath,
    });
  }

  return actions;
}

export function statusText(model: FloatingViewModel): string {
  if (model.status === "unavailable") {
    return "WSL 不可用";
  }

  if (model.status === "empty") {
    return "暂无活跃会话";
  }

  return `${STATUS_LABEL[model.status]} ${model.count} 个`;
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
  const sessions = (snapshot?.sessions ?? []).map((session) => ({
    session,
    copyActions: sessionCopyActions(session, context),
  }));

  const model: FloatingViewModel = {
    status,
    count,
    text: "",
    unavailableReason: context.unavailableReason,
    sessions,
  };

  return {
    ...model,
    text: statusText(model),
  };
}
