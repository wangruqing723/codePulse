import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { exists } from "./files";
import {
  clearCodexNotifyBackup,
  companionPreferencesRoot,
  loadCodexNotifyBackup,
  saveCodexNotifyBackup,
} from "./companion-preferences";

const MARKER = "codepulse-hook";
const TOML_TABLE_PATTERN = /^\s*\[/;
const TOML_NOTIFY_PATTERN = /^\s*notify\s*=/;
const INVALID_LOCK_STALE_MS = 5 * 60 * 1_000;
const EXCLUSIVE_CREATE_ATTEMPTS = 100;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const JSON_NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export type CodexImportedHooksState = "clean" | "conflict" | "invalid";

export interface CodexImportedHooksHealth {
  state: CodexImportedHooksState;
  hooksPath: string;
  count: number;
  eventNames: string[];
  error?: string;
}

export interface HookInstallStatus {
  installed: boolean;
  claudeInstalled: boolean;
  codexInstalled: boolean;
  hookPath: string;
  claudeSettingsPath: string;
  codexConfigPath: string;
  codexImportedHooks: CodexImportedHooksHealth;
}

export type HookTarget = "claude" | "codex" | "all";

export interface HookInstallOptions {
  supportPath: string;
  eventRoot?: string;
  claudeSettingsPath?: string;
  codexConfigPath?: string;
  codexHooksPath?: string;
  // force 覆盖 Codex notify 时，被顶掉的原 notify 存放目录（默认 ~/.codepulse）。
  // 卸载时从这里读回并还原。可注入以便测试。
  notifyBackupRoot?: string;
}

export interface RepairCodexImportedHooksResult {
  status: HookInstallStatus;
  removedCount: number;
  eventNames: string[];
  backupPath?: string;
}

export type RepairCodexImportedHooksPhase =
  | "after-lock-open"
  | "after-lock-write"
  | "locked"
  | "before-stale-takeover"
  | "before-backup"
  | "backup-created"
  | "temp-created"
  | "before-commit"
  | "before-final-path-stat"
  | "committed"
  | "before-release"
  | "before-release-path-stat";

type RepairRandomPurpose = "lock" | "backup" | "temp" | "stale";

/** @internal 仅用于确定性文件系统测试；生产调用保持单参数。 */
export interface RepairCodexImportedHooksRuntime {
  now?: () => number;
  randomToken?: (purpose: RepairRandomPurpose) => string;
  isProcessAlive?: (pid: number) => boolean;
  onPhase?: (phase: RepairCodexImportedHooksPhase) => void | Promise<void>;
}

function hookPath(supportPath: string): string {
  return path.join(supportPath, "bin", MARKER);
}

function backupPath(filePath: string): string {
  return `${filePath}.codepulse.bak`;
}

export function normalizeHookOptions(
  input: string | HookInstallOptions,
): HookInstallOptions {
  return typeof input === "string" ? { supportPath: input } : input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanCodexImportedHooksHealth(
  hooksPath: string,
): CodexImportedHooksHealth {
  return {
    state: "clean",
    hooksPath,
    count: 0,
    eventNames: [],
  };
}

function invalidCodexImportedHooksHealth(
  hooksPath: string,
  error: unknown,
): CodexImportedHooksHealth {
  return {
    state: "invalid",
    hooksPath,
    count: 0,
    eventNames: [],
    error: `无法读取或解析 Codex hooks.json：${errorMessage(error)}`,
  };
}

interface StrictJsonDocument {
  source: string;
  value: unknown;
}

function parseStrictJsonDocument(content: Buffer): StrictJsonDocument {
  const source = STRICT_UTF8_DECODER.decode(content);
  return { source, value: JSON.parse(source) as unknown };
}

function parseStrictJsonBuffer(content: Buffer): unknown {
  return parseStrictJsonDocument(content).value;
}

interface CanonicalDecimal {
  coefficient: string;
  exponent: bigint;
  negative: boolean;
}

function canonicalDecimal(rawNumber: string): CanonicalDecimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(rawNumber);
  if (!match) {
    throw new Error(`Invalid JSON number: ${rawNumber}`);
  }

  const fraction = match[3] ?? "";
  let coefficient = `${match[2]}${fraction}`.replace(/^0+/, "");
  if (!coefficient) {
    return { coefficient: "0", exponent: 0n, negative: false };
  }

  let exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length);
  const trailingZeros = coefficient.match(/0+$/)?.[0].length ?? 0;
  if (trailingZeros > 0) {
    coefficient = coefficient.slice(0, -trailingZeros);
    exponent += BigInt(trailingZeros);
  }

  return {
    coefficient,
    exponent,
    negative: match[1] === "-",
  };
}

function jsonNumberChangesValue(rawNumber: string, value: number): boolean {
  const original = canonicalDecimal(rawNumber);
  const serialized = canonicalDecimal(String(value));
  return (
    original.coefficient !== serialized.coefficient ||
    original.exponent !== serialized.exponent ||
    original.negative !== serialized.negative
  );
}

function containsUnsafeJsonNumber(source: string): boolean {
  let index = 0;

  while (index < source.length) {
    if (source[index] === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (source[index] === "-" || /\d/.test(source[index] ?? "")) {
      JSON_NUMBER_PATTERN.lastIndex = index;
      const match = JSON_NUMBER_PATTERN.exec(source);
      if (!match) {
        index += 1;
        continue;
      }

      const rawNumber = match[0];
      const current = Number(rawNumber);
      if (
        !Number.isFinite(current) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current)) ||
        jsonNumberChangesValue(rawNumber, current)
      ) {
        return true;
      }
      index = JSON_NUMBER_PATTERN.lastIndex;
      continue;
    }

    index += 1;
  }

  return false;
}

function unsafeHooksJsonNumberError(filePath: string): Error {
  return new Error(
    `Codex hooks.json 包含 JavaScript 无法无损表示的数值，CodePulse 拒绝自动修复以避免改写未知字段。请手动删除导入的 Claude hooks，或将该数值改为字符串后重试：${filePath}`,
  );
}

class UnsafeHooksSymlinkError extends Error {
  constructor(filePath: string, targetPath: string) {
    super(
      `Codex hooks.json 是符号链接，CodePulse 不会自动修复。请直接编辑目标文件：${targetPath}（链接：${filePath}）`,
    );
    this.name = "UnsafeHooksSymlinkError";
  }
}

async function unsafeSymlinkError(filePath: string): Promise<Error> {
  let targetPath = "未知目标";
  try {
    const target = await readlink(filePath);
    targetPath = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(filePath), target);
  } catch {
    // lstat 已确认是 symlink；readlink 失败时仍拒绝写盘。
  }
  return new UnsafeHooksSymlinkError(filePath, targetPath);
}

async function assertRepairPathIsNotSymlink(filePath: string): Promise<void> {
  const info = await lstat(filePath, { bigint: true });
  if (info.isSymbolicLink()) {
    throw await unsafeSymlinkError(filePath);
  }
}

// 只解析命令开头的直接 executable 与参数。控制符后的其他 shell 命令不参与匹配，
// 也不会把 echo/sh/env 等包装命令里的字符串误认为 CodePulse executable。
function parseFirstShellCommand(command: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let wordStarted = false;
  let quote: "single" | "double" | undefined;

  const finishWord = () => {
    if (!wordStarted) {
      return;
    }
    words.push(current);
    current = "";
    wordStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote === "single") {
      if (character === "'") {
        quote = undefined;
      } else {
        current += character;
      }
      wordStarted = true;
      continue;
    }

    if (quote === "double") {
      if (character === '"') {
        quote = undefined;
        wordStarted = true;
        continue;
      }
      if (character === "\\") {
        const next = command[index + 1];
        if (
          next === "$" ||
          next === "`" ||
          next === '"' ||
          next === "\\" ||
          next === "\n"
        ) {
          index += 1;
          if (next !== "\n") {
            current += next;
          }
        } else {
          current += "\\";
        }
        wordStarted = true;
        continue;
      }
      current += character;
      wordStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character === "'" ? "single" : "double";
      wordStarted = true;
      continue;
    }

    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined) {
        return undefined;
      }
      if (/\s/.test(next) || "'\"\\;&|<>()".includes(next)) {
        index += 1;
        current += next;
      } else {
        // Windows 的无引号路径以反斜杠分隔；仅在下一个字符确实需要 shell
        // 转义时才移除反斜杠，避免把 C:\\... 拼成一个错误 basename。
        current += "\\";
      }
      wordStarted = true;
      continue;
    }

    if (
      character === ";" ||
      character === "&" ||
      character === "|" ||
      character === "<" ||
      character === ">" ||
      character === "(" ||
      character === ")" ||
      character === "\n" ||
      character === "\r"
    ) {
      finishWord();
      break;
    }

    if (/\s/.test(character)) {
      finishWord();
      continue;
    }

    current += character;
    wordStarted = true;
  }

  if (quote) {
    return undefined;
  }

  finishWord();
  return words;
}

function isCodexImportedClaudeHookLeaf(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.type !== "command" ||
    typeof value.command !== "string"
  ) {
    return false;
  }

  const words = parseFirstShellCommand(value.command);
  if (!words || words.length < 2) {
    return false;
  }

  const executable = path.posix.basename(words[0].replaceAll("\\", "/"));
  return executable === MARKER && words[1] === "claude";
}

interface CodexImportedHooksMatchSummary {
  count: number;
  eventNames: string[];
}

function inspectCodexImportedClaudeHooks(
  value: unknown,
): CodexImportedHooksMatchSummary {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return { count: 0, eventNames: [] };
  }

  let count = 0;
  const eventNames: string[] = [];

  for (const [eventName, groups] of Object.entries(value.hooks)) {
    if (!Array.isArray(groups)) {
      continue;
    }

    let eventCount = 0;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        continue;
      }

      for (const leaf of group.hooks) {
        if (isCodexImportedClaudeHookLeaf(leaf)) {
          eventCount += 1;
        }
      }
    }

    if (eventCount > 0) {
      count += eventCount;
      eventNames.push(eventName);
    }
  }

  return { count, eventNames };
}

function codexImportedHooksHealthFromValue(
  hooksPath: string,
  value: unknown,
): CodexImportedHooksHealth {
  const summary = inspectCodexImportedClaudeHooks(value);
  return summary.count > 0
    ? {
        state: "conflict",
        hooksPath,
        count: summary.count,
        eventNames: summary.eventNames,
      }
    : cleanCodexImportedHooksHealth(hooksPath);
}

async function readCodexImportedHooksHealth(
  hooksPath: string,
): Promise<CodexImportedHooksHealth> {
  let content: Buffer;
  try {
    content = await readFile(hooksPath);
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? cleanCodexImportedHooksHealth(hooksPath)
      : invalidCodexImportedHooksHealth(hooksPath, error);
  }

  try {
    return codexImportedHooksHealthFromValue(
      hooksPath,
      parseStrictJsonBuffer(content),
    );
  } catch (error) {
    return invalidCodexImportedHooksHealth(hooksPath, error);
  }
}

interface RemoveCodexImportedHooksResult {
  value: unknown;
  removedCount: number;
  eventNames: string[];
}

function removeCodexImportedClaudeHookLeaves(
  value: unknown,
): RemoveCodexImportedHooksResult {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return { value, removedCount: 0, eventNames: [] };
  }

  const originalHooks = value.hooks;
  let nextHooks: Record<string, unknown> | undefined;
  let removedCount = 0;
  const eventNames: string[] = [];

  for (const [eventName, groups] of Object.entries(originalHooks)) {
    if (!Array.isArray(groups)) {
      continue;
    }

    let eventRemovedCount = 0;
    const nextGroups: unknown[] = [];

    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        nextGroups.push(group);
        continue;
      }

      const keptLeaves = group.hooks.filter((leaf) => {
        if (!isCodexImportedClaudeHookLeaf(leaf)) {
          return true;
        }
        eventRemovedCount += 1;
        return false;
      });

      if (keptLeaves.length === group.hooks.length) {
        nextGroups.push(group);
        continue;
      }

      const nextGroup = { ...group, hooks: keptLeaves };
      const groupKeys = Object.keys(nextGroup);
      if (
        keptLeaves.length === 0 &&
        groupKeys.length === 1 &&
        groupKeys[0] === "hooks"
      ) {
        continue;
      }
      nextGroups.push(nextGroup);
    }

    if (eventRemovedCount === 0) {
      continue;
    }

    nextHooks ??= { ...originalHooks };
    if (nextGroups.length === 0) {
      delete nextHooks[eventName];
    } else {
      nextHooks[eventName] = nextGroups;
    }
    removedCount += eventRemovedCount;
    eventNames.push(eventName);
  }

  if (!nextHooks) {
    return { value, removedCount: 0, eventNames: [] };
  }

  return {
    value: { ...value, hooks: nextHooks },
    removedCount,
    eventNames,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildClaudeHookCommand(
  scriptPath: string,
  eventName: string,
): string {
  return `${shellQuote(scriptPath)} claude --event ${shellQuote(eventName)}`;
}

async function backupIfExists(filePath: string): Promise<void> {
  if (!(await exists(filePath))) {
    return;
  }

  const target = backupPath(filePath);
  if (await exists(target)) {
    return;
  }

  await copyFile(filePath, target);
}

function hookScriptContent({
  supportPath,
  eventRoot,
}: HookInstallOptions): string {
  const eventsDir = eventRoot ?? path.join(supportPath, "events");
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const supportPath = ${JSON.stringify(supportPath)};
const eventsDir = ${JSON.stringify(eventsDir)};
const args = process.argv.slice(2);

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseStdinJson() {
  const input = readStdin().trim();
  if (!input) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function parseArgJson() {
  const input = args.find((arg) => arg.trim().startsWith("{"));
  if (!input) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function agentFromTranscriptPath(transcriptPath) {
  const segments = String(transcriptPath || "").replaceAll("\\\\", "/").split("/");
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] === ".codex" && segments[index + 1] === "sessions") return "codex";
    if (segments[index] === ".claude" && segments[index + 1] === "projects") return "claude";
  }
  return undefined;
}

function mapEvent(rawEvent) {
  const eventName = String(rawEvent || "").toLowerCase();
  if (eventName === "sessionstart") return undefined;
  if (eventName.includes("error")) return "error";
  if (eventName === "notification" || eventName.includes("waiting") || eventName.includes("approval")) return "waiting";
  if (eventName === "stop" || eventName.includes("done") || eventName.includes("task_complete") || eventName.includes("turn-complete")) return "done";
  if (eventName === "userpromptsubmit" || eventName.includes("prompt") || eventName.includes("start")) return "running";
  return "running";
}

try {
  const requestedAgent = args[0] === "codex" ? "codex" : "claude";
  const raw = parseStdinJson() || parseArgJson();
  const transcriptPath = raw?.transcript_path || raw?.transcriptPath || raw?.payload?.transcript_path || raw?.payload?.transcriptPath;
  const agent = agentFromTranscriptPath(transcriptPath) || requestedAgent;
  const rawEvent = flagValue("--event") || raw?.hook_event_name || raw?.event || raw?.type || raw?.payload?.type;
  const kind = agent === "codex" ? mapEvent(rawEvent || "waiting") : mapEvent(rawEvent);
  if (!kind) process.exit(0);
  const event = {
    id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
    agent,
    kind,
    timestamp: new Date().toISOString(),
    eventName: rawEvent,
    sessionId: flagValue("--session") || raw?.session_id || raw?.sessionId || raw?.payload?.session_id,
    cwd: raw?.cwd || raw?.workspace?.cwd || raw?.payload?.cwd || process.cwd(),
    transcriptPath,
    message: raw?.message || raw?.payload?.message,
  };
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, event.id + ".json"), JSON.stringify(event));
} catch {
}

process.exit(0);
`;
}

export async function writeHookScript(
  input: string | HookInstallOptions,
): Promise<string> {
  const options = normalizeHookOptions(input);
  const scriptPath = hookPath(options.supportPath);
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, hookScriptContent(options));
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function readJsonFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function replaceCodePulseHookCommand(
  value: unknown,
  command: string,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = replaceCodePulseHookCommand(item, command);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  let changed = false;
  const next = { ...value };

  if (typeof next.command === "string" && next.command.includes(MARKER)) {
    next.command = command;
    changed = true;
  }

  for (const [key, child] of Object.entries(next)) {
    if (key === "command") {
      continue;
    }

    const result = replaceCodePulseHookCommand(child, command);
    if (result.changed) {
      next[key] = result.value;
      changed = true;
    }
  }

  return { value: changed ? next : value, changed };
}

export function upsertCodePulseClaudeHook(
  settings: Record<string, unknown>,
  eventName: string,
  command: string,
): void {
  const hooks = (
    settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}
  ) as Record<string, unknown>;
  const existingItems = Array.isArray(hooks[eventName])
    ? (hooks[eventName] as unknown[])
    : [];
  const replacement = replaceCodePulseHookCommand(existingItems, command);
  const nextItems = Array.isArray(replacement.value)
    ? replacement.value
    : existingItems;
  const alreadyInstalled = JSON.stringify(nextItems).includes(MARKER);

  if (!replacement.changed && !alreadyInstalled) {
    nextItems.push({
      hooks: [
        {
          type: "command",
          command,
        },
      ],
    });
  }

  hooks[eventName] = nextItems;
  settings.hooks = hooks;
}

export function removeCodePulseClaudeHook(
  settings: Record<string, unknown>,
  eventName: string,
): void {
  const hooks = (
    settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}
  ) as Record<string, unknown>;
  const existingItems = Array.isArray(hooks[eventName])
    ? (hooks[eventName] as unknown[])
    : [];

  hooks[eventName] = existingItems.filter(
    (item) => !JSON.stringify(item).includes(MARKER),
  );
  settings.hooks = hooks;
}

async function installClaudeHooks(
  settingsPath: string,
  scriptPath: string,
): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await backupIfExists(settingsPath);

  const settings = await readJsonFile(settingsPath);
  removeCodePulseClaudeHook(settings, "SessionStart");
  upsertCodePulseClaudeHook(
    settings,
    "Notification",
    buildClaudeHookCommand(scriptPath, "Notification"),
  );
  upsertCodePulseClaudeHook(
    settings,
    "Stop",
    buildClaudeHookCommand(scriptPath, "Stop"),
  );
  upsertCodePulseClaudeHook(
    settings,
    "UserPromptSubmit",
    buildClaudeHookCommand(scriptPath, "UserPromptSubmit"),
  );

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function removeCodePulseClaudeHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const hooks = (
    settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {}
  ) as Record<string, unknown>;

  for (const [eventName, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      continue;
    }

    hooks[eventName] = value.filter(
      (item) => !JSON.stringify(item).includes(MARKER),
    );
  }

  settings.hooks = hooks;
  return settings;
}

async function installCodexNotify(
  configPath: string,
  scriptPath: string,
  force: boolean,
  notifyBackupRoot: string,
): Promise<void> {
  let content = "";
  try {
    content = await readFile(configPath, "utf8");
  } catch {
    content = "";
  }

  // 先在写盘前计算结果：若存在非 CodePulse 的 notify 冲突，upsert 会抛错，
  // 此时不应创建目录或备份，保持 config.toml 原样，交由上层提示用户。
  const next = upsertCodePulseCodexNotify(content, scriptPath, { force });

  // force 覆盖时，把被顶掉的用户既有 notify 无损存到 CodePulse 自己的目录，
  // 供卸载时还原（Codex 的一次性 .codepulse.bak 可能过期或不含该配置）。
  if (force) {
    const conflicting = extractConflictingNotify(content);
    if (conflicting) {
      await saveCodexNotifyBackup(notifyBackupRoot, conflicting);
    }
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  await backupIfExists(configPath);
  await writeFile(configPath, next);
}

// Codex 的 notify 是单一顶层键，只能指向一个程序。当检测到一个非 CodePulse 的
// notify 已存在（例如 Codex Computer Use 的 SkyComputerUseClient）时，抛出此错误
// 交由上层提示用户，避免静默覆盖用户既有配置。
export class CodexNotifyConflictError extends Error {
  readonly existingNotify: string;

  constructor(existingNotify: string) {
    super("Codex 已存在非 CodePulse 的 notify 配置");
    this.name = "CodexNotifyConflictError";
    this.existingNotify = existingNotify;
  }
}

// 计算一行内未被字符串包裹的方括号净增量，用于跨行追踪数组是否闭合。
function bracketDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let quote = "";
  for (const char of line) {
    if (inString) {
      if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
    } else if (char === "[") {
      delta += 1;
    } else if (char === "]") {
      delta -= 1;
    }
  }

  return delta;
}

// 从 notify 起始行出发，返回该赋值的最后一行下标（含）。支持单行标量、单行数组
// 与跨多行的数组写法（Codex 桌面版会把 notify 重写成多行数组）。
function notifyBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let sawBracket = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("[")) {
      sawBracket = true;
    }
    depth += bracketDelta(line);

    if (!sawBracket || depth <= 0) {
      return index;
    }
  }

  return lines.length - 1;
}

interface NotifyBlock {
  start: number;
  end: number;
}

function findTopLevelNotifyBlock(lines: string[]): NotifyBlock | undefined {
  const firstTableIndex = lines.findIndex((item) =>
    TOML_TABLE_PATTERN.test(item),
  );
  const topLevelEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  const start = lines.findIndex(
    (item, index) => index < topLevelEnd && TOML_NOTIFY_PATTERN.test(item),
  );
  if (start < 0) {
    return undefined;
  }

  return { start, end: notifyBlockEnd(lines, start) };
}

export interface UpsertCodexNotifyOptions {
  force?: boolean;
}

// 把一段 notify 文本（单行或多行数组）插入到第一个 TOML 表之前的顶层区域。
function insertTopLevelNotify(cleaned: string, notifyText: string): string {
  const lines = cleaned.split(/\r?\n/);
  const firstTableIndex = lines.findIndex((item) =>
    TOML_TABLE_PATTERN.test(item),
  );
  if (firstTableIndex < 0) {
    const prefix = cleaned.trimEnd();
    return `${prefix ? `${prefix}\n` : ""}${notifyText}\n`;
  }

  const prefix = lines.slice(0, firstTableIndex).join("\n").trimEnd();
  const suffix = lines.slice(firstTableIndex).join("\n").trimStart();
  return `${prefix ? `${prefix}\n` : ""}${notifyText}\n\n${suffix}`
    .trimEnd()
    .concat("\n");
}

export function upsertCodePulseCodexNotify(
  content: string,
  scriptPath: string,
  options: UpsertCodexNotifyOptions = {},
): string {
  const line = `notify = [${JSON.stringify(scriptPath)}, "codex"]`;
  // 先移除 CodePulse 自己写过的 notify，剩下的任何顶层 notify 都属于用户既有配置。
  const cleaned = removeCodePulseCodexNotify(content);
  const lines = cleaned.split(/\r?\n/);

  const block = findTopLevelNotifyBlock(lines);
  if (block) {
    if (!options.force) {
      throw new CodexNotifyConflictError(
        lines
          .slice(block.start, block.end + 1)
          .join("\n")
          .trim(),
      );
    }

    lines.splice(block.start, block.end - block.start + 1, line);
    return `${lines.join("\n").trimEnd()}\n`;
  }

  return insertTopLevelNotify(cleaned, line);
}

// 返回本次覆盖会顶掉的、用户既有的非 CodePulse 顶层 notify 文本（若无则 undefined）。
// 用于在 force 覆盖前把原配置无损保存下来，供卸载时还原。
export function extractConflictingNotify(content: string): string | undefined {
  const cleaned = removeCodePulseCodexNotify(content);
  const block = findTopLevelNotifyBlock(cleaned.split(/\r?\n/));
  if (!block) {
    return undefined;
  }

  return cleaned
    .split(/\r?\n/)
    .slice(block.start, block.end + 1)
    .join("\n")
    .trim();
}

// 卸载时把此前被 CodePulse 顶掉的原 notify 还原回顶层；若当前已有顶层 notify
// 则不重复插入（保持幂等）。
export function restoreCodexNotify(
  content: string,
  notifyText: string,
): string {
  const cleaned = removeCodePulseCodexNotify(content);
  if (findTopLevelNotifyBlock(cleaned.split(/\r?\n/))) {
    return cleaned;
  }

  return insertTopLevelNotify(cleaned, notifyText);
}

// 移除 CodePulse 写入的 notify（含 marker），支持单行与多行数组整块删除；
// 保留用户既有的其他 notify 配置。
export function removeCodePulseCodexNotify(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (TOML_NOTIFY_PATTERN.test(lines[index])) {
      const end = notifyBlockEnd(lines, index);
      const blockText = lines.slice(index, end + 1).join("\n");
      if (blockText.includes(MARKER)) {
        index = end + 1;
        continue;
      }

      for (let cursor = index; cursor <= end; cursor += 1) {
        kept.push(lines[cursor]);
      }
      index = end + 1;
      continue;
    }

    kept.push(lines[index]);
    index += 1;
  }

  return kept.join("\n").trimEnd().concat("\n");
}

interface FileSignature {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

interface StableFileSnapshot {
  content: Buffer;
  signature: FileSignature;
  mode: number;
}

interface BigIntStatLike extends FileSignature {
  mode: bigint;
}

function fileSignature(stats: BigIntStatLike): FileSignature {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
  };
}

function sameFileSignature(left: FileSignature, right: FileSignature): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function sameFileSnapshot(
  left: StableFileSnapshot,
  right: StableFileSnapshot,
): boolean {
  return (
    sameFileSignature(left.signature, right.signature) &&
    left.content.equals(right.content)
  );
}

function concurrentCodexHooksChangeError(): Error {
  return new Error("Codex hooks.json 配置已变化，请刷新后重试");
}

async function readStableFileSnapshot(
  filePath: string,
  beforePathStat?: () => void | Promise<void>,
): Promise<StableFileSnapshot> {
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    const content = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const beforeSignature = fileSignature(before);
    const afterSignature = fileSignature(after);
    await beforePathStat?.();
    const currentPathSignature = fileSignature(
      await stat(filePath, { bigint: true }),
    );
    const currentLinkStats = await lstat(filePath, { bigint: true });
    if (currentLinkStats.isSymbolicLink()) {
      throw await unsafeSymlinkError(filePath);
    }
    const currentLinkSignature = fileSignature(currentLinkStats);

    if (
      !sameFileSignature(beforeSignature, afterSignature) ||
      !sameFileSignature(afterSignature, currentPathSignature) ||
      !sameFileSignature(afterSignature, currentLinkSignature)
    ) {
      throw concurrentCodexHooksChangeError();
    }

    return {
      content,
      signature: afterSignature,
      mode: Number(after.mode & 0o777n),
    };
  } finally {
    await handle.close();
  }
}

async function assertFileSnapshotUnchanged(
  filePath: string,
  expected: StableFileSnapshot,
  beforePathStat?: () => void | Promise<void>,
): Promise<void> {
  let current: StableFileSnapshot;
  try {
    current = await readStableFileSnapshot(filePath, beforePathStat);
  } catch (error) {
    if (error instanceof UnsafeHooksSymlinkError) {
      throw error;
    }
    throw concurrentCodexHooksChangeError();
  }

  if (
    !sameFileSignature(current.signature, expected.signature) ||
    !current.content.equals(expected.content)
  ) {
    throw concurrentCodexHooksChangeError();
  }
}

interface ResolvedRepairRuntime {
  now: () => number;
  randomToken: (purpose: RepairRandomPurpose) => string;
  isProcessAlive: (pid: number) => boolean;
  onPhase: (phase: RepairCodexImportedHooksPhase) => Promise<void>;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function resolveRepairRuntime(
  runtime: RepairCodexImportedHooksRuntime,
): ResolvedRepairRuntime {
  return {
    now: runtime.now ?? Date.now,
    randomToken: runtime.randomToken ?? (() => randomBytes(12).toString("hex")),
    isProcessAlive: runtime.isProcessAlive ?? defaultIsProcessAlive,
    onPhase: async (phase) => {
      await runtime.onPhase?.(phase);
    },
  };
}

function compactTimestamp(timestamp: number): string {
  const value = new Date(timestamp).toISOString();
  return `${value.slice(0, 10).replaceAll("-", "")}-${value
    .slice(11, 19)
    .replaceAll(":", "")}-${value.slice(20, 23)}`;
}

interface RepairLockRecord {
  pid: number;
  createdAt: number;
  token: string;
}

interface HeldRepairLock {
  path: string;
  token: string;
  signature: FileSignature;
  stalePaths: string[];
}

function parseRepairLockRecord(content: string): RepairLockRecord | undefined {
  try {
    const value = JSON.parse(content) as unknown;
    if (
      !isRecord(value) ||
      !Number.isInteger(value.pid) ||
      (value.pid as number) <= 0 ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      typeof value.token !== "string" ||
      value.token.length === 0
    ) {
      return undefined;
    }

    return {
      pid: value.pid as number,
      createdAt: value.createdAt,
      token: value.token,
    };
  } catch {
    return undefined;
  }
}

function invalidLockIsFresh(
  snapshot: StableFileSnapshot,
  now: number,
): boolean {
  const latestMetadataNs =
    snapshot.signature.mtimeNs > snapshot.signature.ctimeNs
      ? snapshot.signature.mtimeNs
      : snapshot.signature.ctimeNs;
  const latestMetadataMs = Number(latestMetadataNs / 1_000_000n);
  return now - latestMetadataMs <= INVALID_LOCK_STALE_MS;
}

async function tryCreateRepairLock(
  lockPath: string,
  record: RepairLockRecord,
  runtime: ResolvedRepairRuntime,
): Promise<FileSignature | undefined> {
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      return undefined;
    }
    throw error;
  }

  let recordWritten = false;
  let initializedSignature: FileSignature | undefined;
  try {
    await runtime.onPhase("after-lock-open");
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
    recordWritten = true;
    await runtime.onPhase("after-lock-write");

    initializedSignature = fileSignature(await handle.stat({ bigint: true }));
    const currentPathSignature = fileSignature(
      await stat(lockPath, { bigint: true }),
    );
    const currentLinkStats = await lstat(lockPath, { bigint: true });
    if (currentLinkStats.isSymbolicLink()) {
      throw await unsafeSymlinkError(lockPath);
    }
    const currentLinkSignature = fileSignature(currentLinkStats);
    if (
      !sameFileSignature(initializedSignature, currentPathSignature) ||
      !sameFileSignature(initializedSignature, currentLinkSignature)
    ) {
      throw new Error("Codex hooks.json 修复锁在初始化期间发生变化");
    }

    await handle.close();
    return initializedSignature;
  } catch (error) {
    let handleSignature = initializedSignature;
    if (!handleSignature) {
      try {
        handleSignature = fileSignature(await handle.stat({ bigint: true }));
      } catch {
        handleSignature = undefined;
      }
    }
    await handle.close().catch(() => undefined);

    if (handleSignature) {
      try {
        const current = await readStableFileSnapshot(lockPath);
        const currentRecord = recordWritten
          ? parseRepairLockRecord(current.content.toString("utf8"))
          : undefined;
        if (
          sameFileSignature(current.signature, handleSignature) &&
          (!recordWritten || currentRecord?.token === record.token)
        ) {
          // 初始化失败只清理仍指向本次 inode 的锁；最终 stat -> unlink 仍是
          // best-effort，路径或 token 不一致时保留后来者。
          await unlink(lockPath).catch(() => undefined);
        }
      } catch {
        // 路径已消失、变成 symlink 或由后来者替换时均不删除。
      }
    }
    throw error;
  }
}

async function cleanupPaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map((item) => unlink(item).catch(() => undefined)));
}

async function acquireRepairLock(
  hooksPath: string,
  runtime: ResolvedRepairRuntime,
): Promise<HeldRepairLock> {
  const lockPath = `${hooksPath}.codepulse-import.lock`;
  const token = runtime.randomToken("lock");
  const stalePaths: string[] = [];

  try {
    for (let attempt = 0; attempt < EXCLUSIVE_CREATE_ATTEMPTS; attempt += 1) {
      const record = { pid: process.pid, createdAt: runtime.now(), token };
      const acquiredSignature = await tryCreateRepairLock(
        lockPath,
        record,
        runtime,
      );
      if (acquiredSignature) {
        return {
          path: lockPath,
          token,
          signature: acquiredSignature,
          stalePaths,
        };
      }

      let observedLock: StableFileSnapshot;
      try {
        observedLock = await readStableFileSnapshot(lockPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          continue;
        }
        throw new Error(
          `无法检查 Codex hooks.json 修复锁：${errorMessage(error)}`,
        );
      }

      const existing = parseRepairLockRecord(
        observedLock.content.toString("utf8"),
      );
      // 新锁协议不以 createdAt 租约接管活进程：结构有效且 PID 仍存活时始终 busy。
      if (existing && runtime.isProcessAlive(existing.pid)) {
        throw new Error("CodePulse 正在修复 Codex hooks.json，请稍后重试");
      }

      // open("wx") 与 token 写入之间允许持有者暂停。新鲜的空/损坏锁一律视为
      // 正在初始化；仅元数据已超过保守期限的 invalid 锁才能进入 stale 接管。
      if (!existing && invalidLockIsFresh(observedLock, runtime.now())) {
        throw new Error("CodePulse 正在修复 Codex hooks.json，请稍后重试");
      }
      await runtime.onPhase("before-stale-takeover");

      let currentLock: StableFileSnapshot;
      try {
        currentLock = await readStableFileSnapshot(lockPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          continue;
        }
        throw new Error(
          `无法复核 Codex hooks.json 修复锁：${errorMessage(error)}`,
        );
      }
      if (!sameFileSnapshot(currentLock, observedLock)) {
        continue;
      }

      const stalePath = `${lockPath}.stale-${compactTimestamp(
        runtime.now(),
      )}-${runtime.randomToken("stale")}`;
      try {
        // stale 复核与 rename 仍不是条件原子操作，只能 best-effort 缩小竞态窗口。
        await rename(lockPath, stalePath);
        stalePaths.push(stalePath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          continue;
        }
        throw error;
      }
    }

    throw new Error("无法获取 Codex hooks.json 修复锁，请稍后重试");
  } catch (error) {
    await cleanupPaths(stalePaths);
    throw error;
  }
}

async function releaseRepairLock(
  lock: HeldRepairLock,
  runtime: ResolvedRepairRuntime,
): Promise<void> {
  try {
    const snapshot = await readStableFileSnapshot(lock.path, () =>
      runtime.onPhase("before-release-path-stat"),
    );
    const current = parseRepairLockRecord(snapshot.content.toString("utf8"));
    if (
      current?.token === lock.token &&
      sameFileSignature(snapshot.signature, lock.signature)
    ) {
      // 这里已校验 token、获取时 signature、当前 path stat 与最终 lstat；最后的
      // stat -> unlink 仍不是可移植 CAS，因此后来者发生变化时宁可保留锁。
      await unlink(lock.path).catch(() => undefined);
    }
  } catch {
    // 锁丢失、不可读或已被后来者接管时均不删除，后续 stale 检查可恢复。
  } finally {
    await cleanupPaths(lock.stalePaths);
  }
}

async function createUniqueBackup(
  hooksPath: string,
  snapshot: StableFileSnapshot,
  runtime: ResolvedRepairRuntime,
): Promise<string> {
  const timestamp = compactTimestamp(runtime.now());

  for (let attempt = 0; attempt < EXCLUSIVE_CREATE_ATTEMPTS; attempt += 1) {
    const backupPath = `${hooksPath}.codepulse-import-${timestamp}-${runtime.randomToken(
      "backup",
    )}.bak`;
    let handle;
    try {
      handle = await open(backupPath, "wx", snapshot.mode);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        continue;
      }
      throw error;
    }

    try {
      await handle.writeFile(snapshot.content);
      await handle.sync();
      await handle.chmod(snapshot.mode).catch(() => undefined);
      await handle.close();

      const written = await readFile(backupPath);
      if (!written.equals(snapshot.content)) {
        throw new Error("Codex hooks.json 备份校验失败");
      }
      return backupPath;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(backupPath).catch(() => undefined);
      throw error;
    }
  }

  throw new Error("无法创建唯一的 Codex hooks.json 备份");
}

async function createExclusiveTempFile(
  hooksPath: string,
  content: Buffer,
  mode: number,
  runtime: ResolvedRepairRuntime,
): Promise<string> {
  for (let attempt = 0; attempt < EXCLUSIVE_CREATE_ATTEMPTS; attempt += 1) {
    const tempPath = `${hooksPath}.codepulse-import-${process.pid}-${runtime.randomToken(
      "temp",
    )}.tmp`;
    let handle;
    try {
      handle = await open(tempPath, "wx", mode);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        continue;
      }
      throw error;
    }

    try {
      await handle.writeFile(content);
      await handle.sync();
      await handle.chmod(mode).catch(() => undefined);
      await handle.close();
      return tempPath;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  throw new Error("无法创建唯一的 Codex hooks.json 临时文件");
}

export async function getHookInstallStatus(
  input: string | HookInstallOptions,
): Promise<HookInstallStatus> {
  const options = normalizeHookOptions(input);
  const scriptPath = hookPath(options.supportPath);
  const claudeSettingsPath =
    options.claudeSettingsPath ??
    path.join(os.homedir(), ".claude", "settings.json");
  const codexConfigPath =
    options.codexConfigPath ?? path.join(os.homedir(), ".codex", "config.toml");
  const codexHooksPath =
    options.codexHooksPath ?? path.join(os.homedir(), ".codex", "hooks.json");
  const [scriptExists, codexImportedHooks] = await Promise.all([
    exists(scriptPath),
    readCodexImportedHooksHealth(codexHooksPath),
  ]);
  const claudeInstalled =
    scriptExists &&
    (await readFile(claudeSettingsPath, "utf8").catch(() => "")).includes(
      MARKER,
    );
  const codexInstalled =
    scriptExists &&
    (await readFile(codexConfigPath, "utf8").catch(() => "")).includes(MARKER);
  const installed = claudeInstalled || codexInstalled;

  return {
    installed,
    claudeInstalled,
    codexInstalled,
    hookPath: scriptPath,
    claudeSettingsPath,
    codexConfigPath,
    codexImportedHooks,
  };
}

export async function repairCodexImportedClaudeHooks(
  input: string | HookInstallOptions,
  runtimeOverrides: RepairCodexImportedHooksRuntime = {},
): Promise<RepairCodexImportedHooksResult> {
  const options = normalizeHookOptions(input);
  const hooksPath =
    options.codexHooksPath ?? path.join(os.homedir(), ".codex", "hooks.json");
  const initialStatus = await getHookInstallStatus(options);
  if (initialStatus.codexImportedHooks.state !== "conflict") {
    return {
      status: initialStatus,
      removedCount: 0,
      eventNames: [],
    };
  }

  try {
    await assertRepairPathIsNotSymlink(hooksPath);
  } catch (error) {
    if (error instanceof UnsafeHooksSymlinkError) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw concurrentCodexHooksChangeError();
    }
    throw error;
  }

  const runtime = resolveRepairRuntime(runtimeOverrides);
  const lock = await acquireRepairLock(hooksPath, runtime);
  let tempPath: string | undefined;

  try {
    await runtime.onPhase("locked");

    let snapshot: StableFileSnapshot;
    try {
      snapshot = await readStableFileSnapshot(hooksPath);
    } catch {
      const status = await getHookInstallStatus(options);
      if (status.codexImportedHooks.state !== "conflict") {
        return { status, removedCount: 0, eventNames: [] };
      }
      throw concurrentCodexHooksChangeError();
    }

    let document: StrictJsonDocument;
    try {
      document = parseStrictJsonDocument(snapshot.content);
    } catch {
      const status = await getHookInstallStatus(options);
      return { status, removedCount: 0, eventNames: [] };
    }

    const removal = removeCodexImportedClaudeHookLeaves(document.value);
    if (removal.removedCount === 0) {
      const status = await getHookInstallStatus(options);
      return { status, removedCount: 0, eventNames: [] };
    }

    if (containsUnsafeJsonNumber(document.source)) {
      throw unsafeHooksJsonNumberError(hooksPath);
    }

    const nextContent = Buffer.from(
      `${JSON.stringify(removal.value, null, 2)}\n`,
      "utf8",
    );

    await runtime.onPhase("before-backup");
    await assertFileSnapshotUnchanged(hooksPath, snapshot);
    const backupPath = await createUniqueBackup(hooksPath, snapshot, runtime);
    await runtime.onPhase("backup-created");

    tempPath = await createExclusiveTempFile(
      hooksPath,
      nextContent,
      snapshot.mode,
      runtime,
    );
    await runtime.onPhase("temp-created");
    await runtime.onPhase("before-commit");
    await assertFileSnapshotUnchanged(hooksPath, snapshot, () =>
      runtime.onPhase("before-final-path-stat"),
    );

    // Codex App 不配合此锁，文件系统也没有可移植的跨进程 CAS。这里的内容/stat
    // 双校验只能把竞态缩小到最终校验与同目录原子 rename 之间，不能宣称绝对消除。
    await rename(tempPath, hooksPath);
    tempPath = undefined;
    await runtime.onPhase("committed");

    return {
      status: await getHookInstallStatus(options),
      removedCount: removal.removedCount,
      eventNames: removal.eventNames,
      backupPath,
    };
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
    }
    try {
      await runtime.onPhase("before-release");
    } finally {
      // token 校验同样是 best-effort；校验与 unlink 之间不存在可移植 CAS。
      await releaseRepairLock(lock, runtime);
    }
  }
}

export interface InstallHooksOptions {
  // 仅对 Codex 生效：检测到非 CodePulse 的 notify 已存在时，是否覆盖。
  force?: boolean;
}

export async function installHooks(
  input: string | HookInstallOptions,
  target: HookTarget = "all",
  installOptions: InstallHooksOptions = {},
): Promise<HookInstallStatus> {
  const options = normalizeHookOptions(input);
  const scriptPath = await writeHookScript(options);
  const claudeSettingsPath =
    options.claudeSettingsPath ??
    path.join(os.homedir(), ".claude", "settings.json");
  const codexConfigPath =
    options.codexConfigPath ?? path.join(os.homedir(), ".codex", "config.toml");

  if (target === "claude" || target === "all") {
    await installClaudeHooks(claudeSettingsPath, scriptPath);
  }

  if (target === "codex" || target === "all") {
    await installCodexNotify(
      codexConfigPath,
      scriptPath,
      installOptions.force ?? false,
      options.notifyBackupRoot ?? companionPreferencesRoot(),
    );
  }

  return getHookInstallStatus(options);
}

export async function uninstallHooks(
  input: string | HookInstallOptions,
  target: HookTarget = "all",
): Promise<HookInstallStatus> {
  const options = normalizeHookOptions(input);
  const claudeSettingsPath =
    options.claudeSettingsPath ??
    path.join(os.homedir(), ".claude", "settings.json");
  const codexConfigPath =
    options.codexConfigPath ?? path.join(os.homedir(), ".codex", "config.toml");

  if (
    (target === "claude" || target === "all") &&
    (await exists(claudeSettingsPath))
  ) {
    const settings = await readJsonFile(claudeSettingsPath);
    await writeFile(
      claudeSettingsPath,
      `${JSON.stringify(removeCodePulseClaudeHooks(settings), null, 2)}\n`,
    );
  }

  if (
    (target === "codex" || target === "all") &&
    (await exists(codexConfigPath))
  ) {
    const backupRoot = options.notifyBackupRoot ?? companionPreferencesRoot();
    const codexConfig = await readFile(codexConfigPath, "utf8");
    // 移除 CodePulse 的 notify 后，如果此前 force 覆盖过用户既有 notify，则把它
    // 还原回去，而不是留下空缺；还原后清理备份，保持幂等。
    const savedNotify = await loadCodexNotifyBackup(backupRoot);
    const withoutCodePulse = removeCodePulseCodexNotify(codexConfig);
    const restored = savedNotify
      ? restoreCodexNotify(withoutCodePulse, savedNotify)
      : withoutCodePulse;
    await writeFile(codexConfigPath, restored);
    if (savedNotify) {
      await clearCodexNotifyBackup(backupRoot);
    }
  }

  return getHookInstallStatus(options);
}
