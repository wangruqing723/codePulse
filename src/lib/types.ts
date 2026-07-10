export type AgentKind = "claude" | "codex";

export type SessionStatus = "running" | "waiting" | "done" | "idle" | "error";

export type SessionSource = "passive" | "hook";

export type SessionOrigin = "user" | "delegated";

export interface Preferences {
  activeWindowMinutes?: string;
  menuBarStyle?: "icon" | "count" | "session";
  enableSound?: boolean;
  monitorProjects?: string;
  companionReleaseTag?: string;
  companionManifestUrl?: string;
}

export interface SessionRecord {
  id: string;
  agent: AgentKind;
  status: SessionStatus;
  source: SessionSource;
  origin?: SessionOrigin;
  cwd?: string;
  projectName: string;
  transcriptPath?: string;
  title: string;
  lastEventAt?: string;
  updatedAt: string;
  runningSince?: string;
  completedAt?: string;
  errorMessage?: string;
  pendingStatus?: SessionStatus;
  pendingCount?: number;
}

export interface StateSnapshot {
  generatedAt: string;
  sessions: SessionRecord[];
  counts: Record<SessionStatus, number>;
}

export interface HookEvent {
  id: string;
  agent: AgentKind;
  kind: "running" | "waiting" | "done" | "error";
  timestamp: string;
  eventName?: string;
  sessionId?: string;
  cwd?: string;
  transcriptPath?: string;
  message?: string;
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "运行中",
  waiting: "轮到你了",
  done: "已完成",
  idle: "空闲",
  error: "出错",
};

export const STATUS_ICON: Record<SessionStatus, string> = {
  running: "🟢",
  waiting: "🟡",
  done: "🔵",
  idle: "⚪",
  error: "🔴",
};

export const AGENT_LABEL: Record<AgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
};
