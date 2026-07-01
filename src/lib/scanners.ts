import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { walkJsonlFiles } from "./files";
import { readFirstJsonLine, readTailJsonLines } from "./jsonl";
import {
  expandHome,
  matchesMonitorPrefixes,
  projectNameFromCwd,
} from "./paths";
import { isoFromMtime } from "./time";
import type { AgentKind, SessionRecord, SessionStatus } from "./types";

const RUNNING_MTIME_WINDOW_MS = 30_000;
const RECENT_EVENT_LINES = 5_000;
const RECENT_EVENT_BYTES = 8 * 1024 * 1024;

interface ScanOptions {
  activeWindowMs: number;
  monitorPrefixes: string[];
  now?: number;
}

export interface JsonObject {
  [key: string]: unknown;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function eventTimestamp(
  event: JsonObject | undefined,
  fallback: string,
): string {
  return stringValue(event?.timestamp) ?? fallback;
}

function decodeClaudeProjectDir(filePath: string): string | undefined {
  const encoded = path.basename(path.dirname(filePath));
  if (!encoded.startsWith("-")) {
    return undefined;
  }

  return `/${encoded.slice(1).split("-").filter(Boolean).join("/")}`;
}

export function inferClaudeStatus(
  event: JsonObject | undefined,
  ageMs: number,
  hasError: boolean,
): SessionStatus {
  if (hasError) {
    return "error";
  }

  if (ageMs > RUNNING_MTIME_WINDOW_MS * 10) {
    return "done";
  }

  const type = stringValue(event?.type);
  const message = asObject(event?.message);
  const stopReason = stringValue(message?.stop_reason);

  if (
    type === "assistant" &&
    stopReason === "tool_use" &&
    ageMs <= RUNNING_MTIME_WINDOW_MS
  ) {
    return "running";
  }

  if (type === "user") {
    return "running";
  }

  if (type === "assistant" && stopReason === "end_turn") {
    return "done";
  }

  return ageMs <= RUNNING_MTIME_WINDOW_MS ? "running" : "done";
}

export function inferCodexStatus(
  event: JsonObject | undefined,
  ageMs: number,
  hasError: boolean,
): SessionStatus {
  if (hasError) {
    return "error";
  }

  const payload = asObject(event?.payload);
  const type = stringValue(event?.type);
  const payloadType = stringValue(payload?.type);

  if (type === "task_complete" || payloadType === "task_complete") {
    return "done";
  }

  if (ageMs <= RUNNING_MTIME_WINDOW_MS) {
    return "running";
  }

  if (
    type === "response_item" ||
    type === "event_msg" ||
    payloadType === "agent_message"
  ) {
    return "done";
  }

  return "idle";
}

function hasClaudeError(events: JsonObject[]): boolean {
  return events.some((event) => {
    const message = asObject(event.message);
    return (
      event.type === "error" ||
      event.isApiErrorMessage === true ||
      message?.isApiErrorMessage === true ||
      typeof event.error === "string"
    );
  });
}

function hasCodexError(events: JsonObject[]): boolean {
  return events.some((event) => {
    const payload = asObject(event.payload);
    return (
      event.type === "error" ||
      payload?.type === "error" ||
      typeof payload?.error === "string"
    );
  });
}

function lastClaudeConversationEvent(
  events: JsonObject[],
): JsonObject | undefined {
  return [...events]
    .reverse()
    .find((event) => event.type === "assistant" || event.type === "user");
}

function lastClaudeTurnStartEvent(
  events: JsonObject[],
): JsonObject | undefined {
  return [...events].reverse().find((event) => event.type === "user");
}

function lastCodexMeaningfulEvent(
  events: JsonObject[],
): JsonObject | undefined {
  return [...events].reverse().find((event) => event.type !== "session_meta");
}

function codexPayloadType(event: JsonObject | undefined): string | undefined {
  const payload = asObject(event?.payload);
  return stringValue(payload?.type);
}

function lastCodexTurnStartEvent(events: JsonObject[]): JsonObject | undefined {
  return [...events].reverse().find((event) => {
    const payloadType = codexPayloadType(event);
    return (
      event.type === "user_message" ||
      payloadType === "task_started" ||
      payloadType === "user_message"
    );
  });
}

export function inferClaudeTurnStartAt(
  events: JsonObject[],
): string | undefined {
  return stringValue(lastClaudeTurnStartEvent(events)?.timestamp);
}

export function inferCodexTurnStartAt(
  events: JsonObject[],
): string | undefined {
  return stringValue(lastCodexTurnStartEvent(events)?.timestamp);
}

function idFromFile(
  agent: AgentKind,
  filePath: string,
  fallback?: string,
): string {
  return `${agent}:${fallback ?? path.basename(filePath, ".jsonl")}`;
}

function timestampMs(value: string | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionFreshnessMs(session: SessionRecord): number {
  return Math.max(
    timestampMs(session.updatedAt),
    timestampMs(session.lastEventAt),
    timestampMs(session.completedAt),
  );
}

export function dedupeSessionsById(sessions: SessionRecord[]): SessionRecord[] {
  const byId = new Map<string, SessionRecord>();

  for (const session of sessions) {
    const previous = byId.get(session.id);
    if (
      !previous ||
      sessionFreshnessMs(session) > sessionFreshnessMs(previous)
    ) {
      byId.set(session.id, session);
    }
  }

  return [...byId.values()];
}

async function scanClaudeFile(
  filePath: string,
  options: ScanOptions,
): Promise<SessionRecord | undefined> {
  const fileStat = await stat(filePath);
  const now = options.now ?? Date.now();
  const ageMs = now - fileStat.mtimeMs;
  if (ageMs > options.activeWindowMs) {
    return undefined;
  }

  const parsedEvents = (
    await readTailJsonLines(filePath, RECENT_EVENT_LINES, RECENT_EVENT_BYTES)
  )
    .map(asObject)
    .filter((event): event is JsonObject => !!event);
  if (parsedEvents.length === 0) {
    return undefined;
  }

  const conversationEvent = lastClaudeConversationEvent(parsedEvents);
  const cwd =
    parsedEvents
      .map((event) => stringValue(event.cwd))
      .find((value): value is string => !!value) ??
    decodeClaudeProjectDir(filePath);

  if (!matchesMonitorPrefixes(cwd, options.monitorPrefixes)) {
    return undefined;
  }

  const lastEventAt = eventTimestamp(
    conversationEvent,
    isoFromMtime(fileStat.mtimeMs),
  );
  const turnStartedAt = inferClaudeTurnStartAt(parsedEvents);
  const sessionId =
    parsedEvents
      .map((event) => stringValue(event.sessionId))
      .find((value): value is string => !!value) ??
    path.basename(filePath, ".jsonl");
  const status = inferClaudeStatus(
    conversationEvent,
    ageMs,
    hasClaudeError(parsedEvents),
  );

  return {
    id: idFromFile("claude", filePath, sessionId),
    agent: "claude",
    status,
    source: "passive",
    cwd,
    projectName: projectNameFromCwd(cwd, "Claude"),
    transcriptPath: filePath,
    title: projectNameFromCwd(cwd, "Claude"),
    lastEventAt,
    updatedAt: isoFromMtime(fileStat.mtimeMs),
    runningSince:
      status === "running" || status === "done" ? turnStartedAt : undefined,
    completedAt: status === "done" ? lastEventAt : undefined,
  };
}

async function scanCodexFile(
  filePath: string,
  options: ScanOptions,
): Promise<SessionRecord | undefined> {
  const fileStat = await stat(filePath);
  const now = options.now ?? Date.now();
  const ageMs = now - fileStat.mtimeMs;
  if (ageMs > options.activeWindowMs) {
    return undefined;
  }

  const firstEvent = asObject(await readFirstJsonLine(filePath));
  const metaPayload = asObject(firstEvent?.payload);
  const parsedEvents = (
    await readTailJsonLines(filePath, RECENT_EVENT_LINES, RECENT_EVENT_BYTES)
  )
    .map(asObject)
    .filter((event): event is JsonObject => !!event);
  const meaningfulEvent = lastCodexMeaningfulEvent(parsedEvents);
  const cwd = stringValue(metaPayload?.cwd);

  if (!matchesMonitorPrefixes(cwd, options.monitorPrefixes)) {
    return undefined;
  }

  const sessionId =
    stringValue(metaPayload?.session_id) ??
    stringValue(metaPayload?.id) ??
    path.basename(filePath, ".jsonl");
  const lastEventAt = eventTimestamp(
    meaningfulEvent,
    isoFromMtime(fileStat.mtimeMs),
  );
  const turnStartedAt = inferCodexTurnStartAt(parsedEvents);
  const status = inferCodexStatus(
    meaningfulEvent,
    ageMs,
    hasCodexError(parsedEvents),
  );

  return {
    id: idFromFile("codex", filePath, sessionId),
    agent: "codex",
    status,
    source: "passive",
    cwd,
    projectName: projectNameFromCwd(cwd, "Codex"),
    transcriptPath: filePath,
    title: projectNameFromCwd(cwd, "Codex"),
    lastEventAt,
    updatedAt: isoFromMtime(fileStat.mtimeMs),
    runningSince:
      status === "running" || status === "done" ? turnStartedAt : undefined,
    completedAt: status === "done" ? lastEventAt : undefined,
  };
}

export async function scanClaudeSessions(
  options: ScanOptions,
): Promise<SessionRecord[]> {
  const root = expandHome("~/.claude/projects");
  const files = await walkJsonlFiles(root, 4);
  const sessions = await Promise.all(
    files.map((file) => scanClaudeFile(file, options).catch(() => undefined)),
  );
  return dedupeSessionsById(
    sessions.filter((session): session is SessionRecord => !!session),
  );
}

export async function scanCodexSessions(
  options: ScanOptions,
): Promise<SessionRecord[]> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  const files = await walkJsonlFiles(root, 6);
  const sessions = await Promise.all(
    files.map((file) => scanCodexFile(file, options).catch(() => undefined)),
  );
  return dedupeSessionsById(
    sessions.filter((session): session is SessionRecord => !!session),
  );
}

export async function scanSessions(
  options: ScanOptions,
): Promise<SessionRecord[]> {
  const [claudeSessions, codexSessions] = await Promise.all([
    scanClaudeSessions(options),
    scanCodexSessions(options),
  ]);
  return [...claudeSessions, ...codexSessions];
}
