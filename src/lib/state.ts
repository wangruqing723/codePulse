import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  matchesMonitorPrefixes,
  parseMonitorProjectPrefixes,
  projectNameFromCwd,
} from "./paths";
import { scanSessions, type ScanRoots } from "./scanners";
import { toPositiveInt } from "./time";
import type {
  AgentKind,
  HookEvent,
  Preferences,
  SessionRecord,
  SessionStatus,
  StateSnapshot,
} from "./types";

const STATUS_ORDER: SessionStatus[] = [
  "waiting",
  "error",
  "running",
  "done",
  "idle",
];
const HOOK_ONLY_RUNNING_GRACE_MS = 30_000;

export function statePath(supportPath: string): string {
  return path.join(supportPath, "state.json");
}

export function eventsPath(supportPath: string): string {
  return path.join(supportPath, "events");
}

export interface StateBuildConfig {
  stateRoot: string;
  eventRoot?: string;
  scanRoots?: Partial<ScanRoots>;
  preferences: Preferences;
  now?: number;
}

export async function loadSnapshot(
  supportPath: string,
): Promise<StateSnapshot | undefined> {
  try {
    return JSON.parse(
      await readFile(statePath(supportPath), "utf8"),
    ) as StateSnapshot;
  } catch {
    return undefined;
  }
}

export async function saveSnapshot(
  supportPath: string,
  snapshot: StateSnapshot,
): Promise<void> {
  await mkdir(supportPath, { recursive: true });
  await writeFile(
    statePath(supportPath),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
}

async function loadHookEvents(
  eventRoot: string,
  activeWindowMs: number,
  now: number,
): Promise<HookEvent[]> {
  let files: string[];
  try {
    files = await readdir(eventRoot);
  } catch {
    return [];
  }

  const events = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const filePath = path.join(eventRoot, file);
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > activeWindowMs) {
          return undefined;
        }

        try {
          return JSON.parse(await readFile(filePath, "utf8")) as HookEvent;
        } catch {
          return undefined;
        }
      }),
  );

  return events.filter((event): event is HookEvent => !!event);
}

function statusCounts(
  sessions: SessionRecord[],
): Record<SessionStatus, number> {
  return {
    running: sessions.filter((session) => session.status === "running").length,
    waiting: sessions.filter((session) => session.status === "waiting").length,
    done: sessions.filter((session) => session.status === "done").length,
    idle: sessions.filter((session) => session.status === "idle").length,
    error: sessions.filter((session) => session.status === "error").length,
  };
}

function sortSessions(a: SessionRecord, b: SessionRecord): number {
  const statusDiff =
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function keyFor(session: SessionRecord): string {
  return `${session.agent}:${session.id}`;
}

function earlierIso(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return new Date(first).getTime() <= new Date(second).getTime()
    ? first
    : second;
}

function timestampMs(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionFreshnessMs(session: SessionRecord | undefined): number {
  if (!session) {
    return 0;
  }

  return Math.max(
    timestampMs(session.updatedAt),
    timestampMs(session.lastEventAt),
    timestampMs(session.completedAt),
  );
}

function eventName(event: HookEvent): string {
  return (event.eventName ?? "").toLowerCase();
}

function transcriptIdentity(transcriptPath: string): string {
  return transcriptPath.replaceAll("\\", "/");
}

function codexTranscriptIdentity(transcriptPath: string): string {
  const normalized = transcriptIdentity(transcriptPath);
  const segments = normalized.split("/");
  const sessionsIndex = segments.findIndex(
    (segment, index) =>
      segment === ".codex" && segments[index + 1] === "sessions",
  );

  return sessionsIndex >= 0
    ? segments.slice(sessionsIndex).join("/")
    : normalized;
}

function agentFromTranscriptPath(
  transcriptPath: string | undefined,
): AgentKind | undefined {
  if (!transcriptPath) {
    return undefined;
  }

  const segments = transcriptIdentity(transcriptPath).split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === ".codex" && segments[index + 1] === "sessions") {
      return "codex";
    }

    if (segments[index] === ".claude" && segments[index + 1] === "projects") {
      return "claude";
    }
  }

  return undefined;
}

function agentForHookEvent(
  event: HookEvent,
  sessions: Map<string, SessionRecord>,
): AgentKind {
  const matchedByTranscript = event.transcriptPath
    ? freshestSession(
        sessions.values(),
        (session) => session.transcriptPath === event.transcriptPath,
      )
    : undefined;

  return (
    matchedByTranscript?.agent ??
    agentFromTranscriptPath(event.transcriptPath) ??
    event.agent
  );
}

function shouldIgnoreHookEvent(
  event: HookEvent,
  previous: SessionRecord | undefined,
  now: number,
): boolean {
  const eventTime = timestampMs(event.timestamp);

  if (eventName(event) === "sessionstart") {
    return true;
  }

  if (previous && eventTime < sessionFreshnessMs(previous)) {
    return true;
  }

  return (
    !previous &&
    event.kind === "running" &&
    !event.transcriptPath &&
    now - eventTime > HOOK_ONLY_RUNNING_GRACE_MS
  );
}

function freshestSession(
  sessions: Iterable<SessionRecord>,
  matches: (session: SessionRecord) => boolean,
): SessionRecord | undefined {
  let freshest: SessionRecord | undefined;

  for (const session of sessions) {
    if (!matches(session)) {
      continue;
    }

    if (
      !freshest ||
      sessionFreshnessMs(session) > sessionFreshnessMs(freshest)
    ) {
      freshest = session;
    }
  }

  return freshest;
}

function sessionIdForHookEvent(
  event: HookEvent,
  sessions: Map<string, SessionRecord>,
): string | undefined {
  if (event.sessionId) {
    const id = `${event.agent}:${event.sessionId}`;
    const matchedById = sessions.get(id);
    if (
      event.agent === "codex" &&
      event.transcriptPath &&
      matchedById?.transcriptPath &&
      codexTranscriptIdentity(event.transcriptPath) !==
        codexTranscriptIdentity(matchedById.transcriptPath)
    ) {
      return undefined;
    }

    return id;
  }

  const matchedByTranscript = event.transcriptPath
    ? freshestSession(
        sessions.values(),
        (session) =>
          session.agent === event.agent &&
          session.transcriptPath === event.transcriptPath,
      )
    : undefined;
  if (matchedByTranscript) {
    return matchedByTranscript.id;
  }

  const matchedByCwd = event.cwd
    ? freshestSession(
        sessions.values(),
        (session) => session.agent === event.agent && session.cwd === event.cwd,
      )
    : undefined;
  if (matchedByCwd) {
    return matchedByCwd.id;
  }

  if (event.agent === "codex") {
    return undefined;
  }

  return `${event.agent}:${event.cwd ?? event.id}`;
}

function runningSinceForHookEvent(
  status: HookEvent["kind"],
  previous: SessionRecord | undefined,
  timestamp: string,
): string | undefined {
  if (status !== "running") {
    return previous?.runningSince;
  }

  if (previous?.status === "running" || previous?.status === "waiting") {
    return previous.runningSince ?? timestamp;
  }

  return timestamp;
}

export function mergeHookEvents(
  sessions: SessionRecord[],
  events: HookEvent[],
  monitorPrefixes: string[],
  now: number,
): SessionRecord[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const sortedEvents = [...events].sort(
    (a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp),
  );

  for (const event of sortedEvents) {
    const agent = agentForHookEvent(event, byId);
    const normalizedEvent = agent === event.agent ? event : { ...event, agent };

    if (!matchesMonitorPrefixes(normalizedEvent.cwd, monitorPrefixes)) {
      continue;
    }

    const id = sessionIdForHookEvent(normalizedEvent, byId);
    if (!id) {
      continue;
    }

    const previous = byId.get(id);
    if (shouldIgnoreHookEvent(normalizedEvent, previous, now)) {
      continue;
    }

    const status = normalizedEvent.kind;
    const updatedAt = normalizedEvent.timestamp;

    byId.set(id, {
      ...previous,
      id,
      agent,
      status,
      source: "hook",
      cwd: normalizedEvent.cwd ?? previous?.cwd,
      projectName: projectNameFromCwd(
        normalizedEvent.cwd ?? previous?.cwd,
        previous?.projectName ?? agent,
      ),
      transcriptPath:
        normalizedEvent.transcriptPath ?? previous?.transcriptPath,
      title: projectNameFromCwd(
        normalizedEvent.cwd ?? previous?.cwd,
        previous?.title ?? agent,
      ),
      lastEventAt: normalizedEvent.timestamp,
      updatedAt,
      runningSince: runningSinceForHookEvent(
        status,
        previous,
        normalizedEvent.timestamp,
      ),
      completedAt:
        status === "done" ? normalizedEvent.timestamp : previous?.completedAt,
      errorMessage:
        status === "error" ? normalizedEvent.message : previous?.errorMessage,
    });
  }

  return [...byId.values()].filter(
    (session) => now - new Date(session.updatedAt).getTime() <= 60 * 60 * 1000,
  );
}

function isImmediateStatus(status: SessionStatus): boolean {
  return status === "running" || status === "waiting" || status === "error";
}

function hasFresherSessionEvent(
  candidate: SessionRecord,
  previous: SessionRecord,
): boolean {
  return sessionFreshnessMs(candidate) > sessionFreshnessMs(previous);
}

function runningSinceForImmediateStatus(
  candidate: SessionRecord,
  previous: SessionRecord,
): string | undefined {
  if (candidate.status !== "running") {
    return candidate.runningSince ?? previous.runningSince;
  }

  if (previous.status === "running" || previous.status === "waiting") {
    return (
      previous.runningSince ?? candidate.runningSince ?? candidate.lastEventAt
    );
  }

  return (
    candidate.runningSince ?? candidate.lastEventAt ?? previous.runningSince
  );
}

export function applyDebounce(
  previous: StateSnapshot | undefined,
  candidates: SessionRecord[],
): SessionRecord[] {
  const previousByKey = new Map(
    (previous?.sessions ?? []).map((session) => [keyFor(session), session]),
  );

  return candidates.map((candidate) => {
    const previousSession = previousByKey.get(keyFor(candidate));
    if (!previousSession || candidate.source === "hook") {
      return candidate;
    }

    if (previousSession.status === candidate.status) {
      return {
        ...candidate,
        runningSince:
          candidate.status === "running"
            ? earlierIso(previousSession.runningSince, candidate.runningSince)
            : (candidate.runningSince ?? previousSession.runningSince),
        pendingStatus: undefined,
        pendingCount: 0,
      };
    }

    if (
      isImmediateStatus(candidate.status) ||
      (candidate.status === "done" &&
        hasFresherSessionEvent(candidate, previousSession))
    ) {
      return {
        ...candidate,
        runningSince: runningSinceForImmediateStatus(
          candidate,
          previousSession,
        ),
        pendingStatus: undefined,
        pendingCount: 0,
      };
    }

    if (previousSession.pendingStatus === candidate.status) {
      const pendingCount = (previousSession.pendingCount ?? 1) + 1;
      if (pendingCount >= 2) {
        return {
          ...candidate,
          runningSince: candidate.runningSince ?? previousSession.runningSince,
          pendingStatus: undefined,
          pendingCount: 0,
        };
      }

      return {
        ...candidate,
        runningSince: candidate.runningSince ?? previousSession.runningSince,
        status: previousSession.status,
        pendingStatus: candidate.status,
        pendingCount,
      };
    }

    return {
      ...candidate,
      runningSince: candidate.runningSince ?? previousSession.runningSince,
      status: previousSession.status,
      pendingStatus: candidate.status,
      pendingCount: 1,
    };
  });
}

export async function buildStateFromConfig(config: StateBuildConfig): Promise<{
  previous?: StateSnapshot;
  snapshot: StateSnapshot;
}> {
  const previous = await loadSnapshot(config.stateRoot);
  const now = config.now ?? Date.now();
  const activeWindowMs =
    toPositiveInt(config.preferences.activeWindowMinutes, 5) * 60 * 1000;
  const monitorPrefixes = parseMonitorProjectPrefixes(
    config.preferences.monitorProjects,
  );
  const passiveSessions = await scanSessions({
    activeWindowMs,
    monitorPrefixes,
    now,
    roots: config.scanRoots,
  });
  const hookEvents = await loadHookEvents(
    config.eventRoot ?? eventsPath(config.stateRoot),
    activeWindowMs,
    now,
  );
  const merged = mergeHookEvents(
    passiveSessions,
    hookEvents,
    monitorPrefixes,
    now,
  );
  const sessions = applyDebounce(previous, merged).sort(sortSessions);
  const snapshot = {
    generatedAt: new Date(now).toISOString(),
    sessions,
    counts: statusCounts(sessions),
  };

  await saveSnapshot(config.stateRoot, snapshot);

  return { previous, snapshot };
}

export async function buildState(
  supportPath: string,
  preferences: Preferences,
): Promise<{
  previous?: StateSnapshot;
  snapshot: StateSnapshot;
}> {
  return buildStateFromConfig({
    stateRoot: supportPath,
    eventRoot: eventsPath(supportPath),
    preferences,
  });
}
