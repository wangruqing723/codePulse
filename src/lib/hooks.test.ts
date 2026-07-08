import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeHookCommand,
  CodexNotifyConflictError,
  extractConflictingNotify,
  installHooks,
  removeCodePulseClaudeHook,
  removeCodePulseCodexNotify,
  restoreCodexNotify,
  uninstallHooks,
  upsertCodePulseClaudeHook,
  upsertCodePulseCodexNotify,
} from "./hooks";
import * as hooks from "./hooks";

const SCRIPT_PATH = "/tmp/codepulse-hook";
const NOTIFY_LINE = `notify = ["${SCRIPT_PATH}", "codex"]`;

describe("Claude hook config", () => {
  it("quotes hook script paths for shell execution", () => {
    expect(
      buildClaudeHookCommand(
        "/Users/wyong/Library/Application Support/codepulse-hook",
        "SessionStart",
      ),
    ).toBe(
      "'/Users/wyong/Library/Application Support/codepulse-hook' claude --event 'SessionStart'",
    );
  });

  it("replaces an existing unquoted CodePulse hook command", () => {
    const settings: Record<string, unknown> = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "/Users/wyong/Library/Application Support/codepulse-hook claude --event SessionStart",
              },
            ],
          },
        ],
      },
    };
    const command = buildClaudeHookCommand(
      "/Users/wyong/Library/Application Support/codepulse-hook",
      "SessionStart",
    );

    upsertCodePulseClaudeHook(settings, "SessionStart", command);

    const hooks = settings.hooks as Record<string, unknown>;
    const sessionStart = hooks.SessionStart as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(sessionStart).toHaveLength(1);
    expect(sessionStart[0].hooks[0].command).toBe(command);
  });

  it("removes obsolete SessionStart CodePulse hooks", () => {
    const settings: Record<string, unknown> = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "'/Users/wyong/Library/Application Support/codepulse-hook' claude --event 'SessionStart'",
              },
            ],
          },
          {
            hooks: [{ type: "command", command: "/bin/keep" }],
          },
        ],
      },
    };

    removeCodePulseClaudeHook(settings, "SessionStart");

    const hooks = settings.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toEqual([
      {
        hooks: [{ type: "command", command: "/bin/keep" }],
      },
    ]);
  });
});

describe("Codex notify config", () => {
  it("inserts CodePulse notify before the first TOML table", () => {
    const next = upsertCodePulseCodexNotify(
      'model = "gpt-5.5"\n\n[mcp_servers]\n',
      SCRIPT_PATH,
    );

    expect(next).toBe(`model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[mcp_servers]\n`);
  });

  it("moves a nested CodePulse notify line back to top level", () => {
    const next = upsertCodePulseCodexNotify(
      `[mcp_servers]\n${NOTIFY_LINE}\n`,
      SCRIPT_PATH,
    );

    expect(next).toBe(`${NOTIFY_LINE}\n\n[mcp_servers]\n`);
  });

  it("updates its own existing CodePulse notify line in place", () => {
    const next = upsertCodePulseCodexNotify(
      `model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`,
      SCRIPT_PATH,
    );

    expect(next).toBe(`model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`);
  });

  it("throws a conflict for a pre-existing non-CodePulse notify", () => {
    expect(() =>
      upsertCodePulseCodexNotify(
        'model = "gpt-5.5"\nnotify = ["/bin/true"]\n\n[tui]\n',
        SCRIPT_PATH,
      ),
    ).toThrow(CodexNotifyConflictError);
  });

  it("surfaces the conflicting notify text on the error", () => {
    try {
      upsertCodePulseCodexNotify(
        'notify = ["/opt/tool", "turn-ended"]\n',
        SCRIPT_PATH,
      );
      expect.unreachable("expected a conflict error");
    } catch (error) {
      expect(error).toBeInstanceOf(CodexNotifyConflictError);
      expect((error as CodexNotifyConflictError).existingNotify).toBe(
        'notify = ["/opt/tool", "turn-ended"]',
      );
    }
  });

  it("overwrites a conflicting notify when force is set", () => {
    const next = upsertCodePulseCodexNotify(
      'model = "gpt-5.5"\nnotify = ["/bin/true"]\n\n[tui]\n',
      SCRIPT_PATH,
      { force: true },
    );

    expect(next).toBe(`model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`);
  });

  it("detects a conflict across a multi-line notify array", () => {
    expect(() =>
      upsertCodePulseCodexNotify(
        'model = "gpt-5.5"\nnotify = [\n    "/opt/tool",\n    "turn-ended",\n]\n\n[tui]\n',
        SCRIPT_PATH,
      ),
    ).toThrow(CodexNotifyConflictError);
  });

  it("overwrites a multi-line conflicting notify array when forced", () => {
    const next = upsertCodePulseCodexNotify(
      'model = "gpt-5.5"\nnotify = [\n    "/opt/tool",\n    "turn-ended",\n]\n\n[tui]\n',
      SCRIPT_PATH,
      { force: true },
    );

    expect(next).toBe(`model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`);
  });

  it("removes CodePulse notify lines from any TOML table", () => {
    const next = removeCodePulseCodexNotify(
      `model = "gpt-5.5"\n\n[mcp_servers]\n${NOTIFY_LINE}\n`,
    );

    expect(next).toBe('model = "gpt-5.5"\n\n[mcp_servers]\n');
  });

  it("removes a multi-line CodePulse notify array as one block", () => {
    const next = removeCodePulseCodexNotify(
      `model = "gpt-5.5"\nnotify = [\n    "${SCRIPT_PATH}",\n    "codex",\n]\n\nnotify = ["/opt/tool", "turn-ended"]\n`,
    );

    expect(next).toBe(
      'model = "gpt-5.5"\n\nnotify = ["/opt/tool", "turn-ended"]\n',
    );
  });

  it("extracts a conflicting single-line notify for backup", () => {
    expect(
      extractConflictingNotify(
        `model = "gpt-5.5"\nnotify = ["/opt/tool", "turn-ended"]\n\n[tui]\n`,
      ),
    ).toBe('notify = ["/opt/tool", "turn-ended"]');
  });

  it("extracts a conflicting multi-line notify array for backup", () => {
    expect(
      extractConflictingNotify(
        'notify = [\n    "/opt/tool",\n    "turn-ended",\n]\n',
      ),
    ).toBe('notify = [\n    "/opt/tool",\n    "turn-ended",\n]');
  });

  it("ignores a CodePulse notify when extracting conflicts", () => {
    expect(
      extractConflictingNotify(`model = "gpt-5.5"\n${NOTIFY_LINE}\n`),
    ).toBeUndefined();
  });

  it("restores a saved notify after removing CodePulse's own", () => {
    const restored = restoreCodexNotify(
      `model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`,
      'notify = ["/opt/tool", "turn-ended"]',
    );

    expect(restored).toBe(
      'model = "gpt-5.5"\nnotify = ["/opt/tool", "turn-ended"]\n\n[tui]\n',
    );
  });

  it("does not double-insert when a top-level notify already exists on restore", () => {
    const content = 'model = "gpt-5.5"\nnotify = ["/opt/other"]\n';

    expect(
      restoreCodexNotify(content, 'notify = ["/opt/tool", "turn-ended"]'),
    ).toBe(content);
  });
});

function getWriteHookScript(): (
  input: string | { supportPath: string; eventRoot?: string },
) => Promise<string> {
  const candidate = (hooks as Record<string, unknown>).writeHookScript;
  expect(candidate).toBeTypeOf("function");
  return candidate as (
    input: string | { supportPath: string; eventRoot?: string },
  ) => Promise<string>;
}

describe("Hook script event roots", () => {
  it("writes hook script with explicit event root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codepulse-hooks-"));

    try {
      const scriptPath = await getWriteHookScript()({
        supportPath: root,
        eventRoot: "/home/user/.codepulse/events",
      });

      expect(await readFile(scriptPath, "utf8")).toContain(
        'const eventsDir = "/home/user/.codepulse/events";',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes hook script with supportPath events directory by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codepulse-hooks-"));

    try {
      const scriptPath = await getWriteHookScript()(root);

      expect(await readFile(scriptPath, "utf8")).toContain(
        JSON.stringify(path.join(root, "events")),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Codex notify force-overwrite restore flow", () => {
  it("restores the user's original notify on uninstall after a forced overwrite", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codepulse-codex-"));
    const supportPath = path.join(root, "support");
    const notifyBackupRoot = path.join(root, "codepulse");
    const codexConfigPath = path.join(root, "config.toml");
    const original =
      'model = "gpt-5.5"\nnotify = ["/opt/computer-use", "turn-ended"]\n\n[tui]\n';

    try {
      await writeFile(codexConfigPath, original, "utf8");

      // 非 force 安装应因既有 notify 抛冲突，且不改动配置。
      await expect(
        installHooks({ supportPath, codexConfigPath, notifyBackupRoot }, "codex"),
      ).rejects.toBeInstanceOf(CodexNotifyConflictError);
      expect(await readFile(codexConfigPath, "utf8")).toBe(original);

      // force 安装应写入 CodePulse notify，并备份被顶掉的原 notify。
      await installHooks(
        { supportPath, codexConfigPath, notifyBackupRoot },
        "codex",
        { force: true },
      );
      const afterInstall = await readFile(codexConfigPath, "utf8");
      expect(afterInstall).toContain("codepulse-hook");
      expect(afterInstall).not.toContain("/opt/computer-use");

      // 卸载应还原用户原本的 notify，而不是留空。
      await uninstallHooks(
        { supportPath, codexConfigPath, notifyBackupRoot },
        "codex",
      );
      const afterUninstall = await readFile(codexConfigPath, "utf8");
      expect(afterUninstall).toContain(
        'notify = ["/opt/computer-use", "turn-ended"]',
      );
      expect(afterUninstall).not.toContain("codepulse-hook");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
