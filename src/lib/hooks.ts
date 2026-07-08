import os from "node:os";
import path from "node:path";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface HookInstallStatus {
  installed: boolean;
  claudeInstalled: boolean;
  codexInstalled: boolean;
  hookPath: string;
  claudeSettingsPath: string;
  codexConfigPath: string;
}

export type HookTarget = "claude" | "codex" | "all";

export interface HookInstallOptions {
  supportPath: string;
  eventRoot?: string;
  claudeSettingsPath?: string;
  codexConfigPath?: string;
  // force 覆盖 Codex notify 时，被顶掉的原 notify 存放目录（默认 ~/.codepulse）。
  // 卸载时从这里读回并还原。可注入以便测试。
  notifyBackupRoot?: string;
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
  const agent = args[0] === "codex" ? "codex" : "claude";
  const raw = parseStdinJson() || parseArgJson();
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
    transcriptPath: raw?.transcript_path || raw?.transcriptPath || raw?.payload?.transcript_path || raw?.payload?.transcriptPath,
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
        lines.slice(block.start, block.end + 1).join("\n").trim(),
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
  const scriptExists = await exists(scriptPath);
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
  };
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
