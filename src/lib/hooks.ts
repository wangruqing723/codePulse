import os from "node:os";
import path from "node:path";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { exists } from "./files";

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

function hookPath(supportPath: string): string {
  return path.join(supportPath, "bin", MARKER);
}

function backupPath(filePath: string): string {
  return `${filePath}.codepulse.bak`;
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

function hookScriptContent(supportPath: string): string {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const supportPath = ${JSON.stringify(supportPath)};
const eventsDir = path.join(supportPath, "events");
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

async function writeHookScript(supportPath: string): Promise<string> {
  const scriptPath = hookPath(supportPath);
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, hookScriptContent(supportPath));
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
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await backupIfExists(configPath);

  let content = "";
  try {
    content = await readFile(configPath, "utf8");
  } catch {
    content = "";
  }

  await writeFile(configPath, upsertCodePulseCodexNotify(content, scriptPath));
}

export function upsertCodePulseCodexNotify(
  content: string,
  scriptPath: string,
): string {
  const line = `notify = [${JSON.stringify(scriptPath)}, "codex"]`;
  const cleaned = removeCodePulseCodexNotify(content);
  const lines = cleaned.split(/\r?\n/);
  const firstTableIndex = lines.findIndex((item) =>
    TOML_TABLE_PATTERN.test(item),
  );
  const topLevelEnd = firstTableIndex >= 0 ? firstTableIndex : lines.length;
  const topLevelNotifyIndex = lines.findIndex(
    (item, index) => index < topLevelEnd && TOML_NOTIFY_PATTERN.test(item),
  );

  if (topLevelNotifyIndex >= 0) {
    lines[topLevelNotifyIndex] = line;
    return `${lines.join("\n").trimEnd()}\n`;
  }

  if (firstTableIndex < 0) {
    const prefix = cleaned.trimEnd();
    return `${prefix ? `${prefix}\n` : ""}${line}\n`;
  }

  const prefix = lines.slice(0, firstTableIndex).join("\n").trimEnd();
  const suffix = lines.slice(firstTableIndex).join("\n").trimStart();
  return `${prefix ? `${prefix}\n` : ""}${line}\n\n${suffix}`
    .trimEnd()
    .concat("\n");
}

export function removeCodePulseCodexNotify(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !(line.includes("notify") && line.includes(MARKER)))
    .join("\n")
    .trimEnd()
    .concat("\n");
}

export async function getHookInstallStatus(
  supportPath: string,
): Promise<HookInstallStatus> {
  const scriptPath = hookPath(supportPath);
  const claudeSettingsPath = path.join(
    os.homedir(),
    ".claude",
    "settings.json",
  );
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
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

export async function installHooks(
  supportPath: string,
  target: HookTarget = "all",
): Promise<HookInstallStatus> {
  const scriptPath = await writeHookScript(supportPath);
  const claudeSettingsPath = path.join(
    os.homedir(),
    ".claude",
    "settings.json",
  );
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");

  if (target === "claude" || target === "all") {
    await installClaudeHooks(claudeSettingsPath, scriptPath);
  }

  if (target === "codex" || target === "all") {
    await installCodexNotify(codexConfigPath, scriptPath);
  }

  return getHookInstallStatus(supportPath);
}

export async function uninstallHooks(
  supportPath: string,
  target: HookTarget = "all",
): Promise<HookInstallStatus> {
  const claudeSettingsPath = path.join(
    os.homedir(),
    ".claude",
    "settings.json",
  );
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");

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
    const codexConfig = await readFile(codexConfigPath, "utf8");
    await writeFile(codexConfigPath, removeCodePulseCodexNotify(codexConfig));
  }

  return getHookInstallStatus(supportPath);
}
