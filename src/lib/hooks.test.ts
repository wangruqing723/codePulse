import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClaudeHookCommand,
  CodexNotifyConflictError,
  extractConflictingNotify,
  getHookInstallStatus,
  installHooks,
  removeCodePulseClaudeHook,
  removeCodePulseCodexNotify,
  repairCodexImportedClaudeHooks,
  restoreCodexNotify,
  uninstallHooks,
  upsertCodePulseClaudeHook,
  upsertCodePulseCodexNotify,
} from "./hooks";
import * as hooks from "./hooks";

const SCRIPT_PATH = "/tmp/codepulse-hook";
const NOTIFY_LINE = `notify = ["${SCRIPT_PATH}", "codex"]`;
const IMPORTED_CLAUDE_HOOK = {
  type: "command",
  command:
    "'/Users/test/Library/Application Support/com.raycast.macos/extensions/code-pulse/assets/codepulse-hook' claude --event 'Stop'",
};

async function createImportedHooksFixture(): Promise<{
  root: string;
  supportPath: string;
  codexHooksPath: string;
}> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "codepulse-imported-hooks-"),
  );
  return {
    root,
    supportPath: path.join(root, "support"),
    codexHooksPath: path.join(root, "hooks.json"),
  };
}

function importedHooksConfig(
  command = IMPORTED_CLAUDE_HOOK.command,
): Record<string, unknown> {
  return {
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command }],
        },
      ],
    },
  };
}

function invalidUtf8ImportedHooksConfig(): Buffer {
  const serialized = JSON.stringify({
    note: "INVALID_UTF8_SENTINEL",
    ...importedHooksConfig(),
  });
  const [prefix, suffix] = serialized.split("INVALID_UTF8_SENTINEL");
  return Buffer.concat([
    Buffer.from(prefix, "utf8"),
    Buffer.from([0xff]),
    Buffer.from(suffix, "utf8"),
  ]);
}

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

  it.each([
    [
      "POSIX",
      "/Users/test/.codex/sessions/2026/07/10/rollout-codex-session.jsonl",
    ],
    [
      "WSL",
      "\\\\wsl$\\Ubuntu\\home\\test\\.codex\\sessions\\2026\\07\\10\\rollout-codex-session.jsonl",
    ],
  ])(
    "corrects Claude-labeled hooks that contain %s Codex transcripts",
    async (_platform, transcriptPath) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "codepulse-hooks-"));
      const eventRoot = path.join(root, "events");

      try {
        const scriptPath = await getWriteHookScript()({
          supportPath: root,
          eventRoot,
        });
        const result = spawnSync(
          scriptPath,
          [
            "claude",
            "--event",
            "Stop",
            JSON.stringify({
              session_id: "codex-session",
              cwd: "/Users/test/project",
              transcript_path: transcriptPath,
            }),
          ],
          { encoding: "utf8" },
        );

        expect(result.status).toBe(0);
        const files = await readdir(eventRoot);
        expect(files).toHaveLength(1);
        const event = JSON.parse(
          await readFile(path.join(eventRoot, files[0]), "utf8"),
        ) as Record<string, unknown>;
        expect(event).toMatchObject({
          agent: "codex",
          kind: "done",
          eventName: "Stop",
          sessionId: "codex-session",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe("Codex imported Claude hook health", () => {
  it("treats a missing hooks.json as clean without creating files", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toEqual({
        state: "clean",
        hooksPath: fixture.codexHooksPath,
        count: 0,
        eventNames: [],
      });
      expect(await readdir(fixture.root)).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports malformed JSON as invalid", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      await writeFile(fixture.codexHooksPath, "{ not-json", "utf8");

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toMatchObject({
        state: "invalid",
        hooksPath: fixture.codexHooksPath,
        count: 0,
        eventNames: [],
        error: expect.any(String),
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports otherwise valid JSON containing invalid UTF-8 as invalid", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      await writeFile(fixture.codexHooksPath, invalidUtf8ImportedHooksConfig());

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toMatchObject({
        state: "invalid",
        hooksPath: fixture.codexHooksPath,
        count: 0,
        eventNames: [],
        error: expect.any(String),
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports unreadable hooks.json paths as invalid", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      await mkdir(fixture.codexHooksPath);

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toMatchObject({
        state: "invalid",
        count: 0,
        eventNames: [],
        error: expect.any(String),
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("recognizes direct quoted, unquoted, and escaped CodePulse Claude commands", async () => {
    const fixture = await createImportedHooksFixture();
    const config = {
      hooks: {
        Stop: [
          {
            hooks: [
              IMPORTED_CLAUDE_HOOK,
              {
                type: "command",
                command:
                  '"/Users/test/Library/Application Support/codepulse-hook" "claude" --event Stop',
              },
              {
                type: "command",
                command:
                  "/Users/test/.config/raycast/extensions/6f43d34c-1234-4abc-9876/assets/codepulse-hook claude --event Stop",
              },
              {
                type: "command",
                command:
                  '"C:\\Users\\test\\AppData\\Local\\Raycast\\extensions\\old-uuid\\codepulse-hook" claude --event Stop',
              },
              {
                type: "command",
                command:
                  "C:\\Users\\test\\AppData\\Local\\Raycast\\extensions\\old-uuid\\codepulse-hook claude --event Stop",
              },
            ],
          },
        ],
        Notification: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "/Users/test/Library/Application\\ Support/codepulse-hook claude --event Notification",
              },
            ],
          },
        ],
      },
    };

    try {
      await writeFile(fixture.codexHooksPath, JSON.stringify(config), "utf8");

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toEqual({
        state: "conflict",
        hooksPath: fixture.codexHooksPath,
        count: 6,
        eventNames: ["Stop", "Notification"],
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not match Codex, indirect, unrelated, or similar commands", async () => {
    const fixture = await createImportedHooksFixture();
    const commands: Array<Record<string, unknown>> = [
      { type: "command", command: "/tmp/codepulse-hook codex" },
      { type: "command", command: "/tmp/codepulse-hook-wrapper claude" },
      { type: "command", command: "/opt/codegraph/codegraph-hook claude" },
      { type: "command", command: "/opt/comet/comet claude" },
      { type: "command", command: "/bin/echo codepulse-hook claude" },
      {
        type: "command",
        command: "/bin/sh -c '/tmp/codepulse-hook claude'",
      },
      { type: "prompt", command: "/tmp/codepulse-hook claude" },
      { type: "command", command: "/opt/claude-hook Stop" },
      { type: "command", command: "'codepulse-hook claude'" },
      { type: "command", command: "'/tmp/codepulse-hook claude" },
      { type: "command", command: '"/tmp/codepulse-hook" "clau\\de"' },
      {
        type: "command",
        command: "/bin/true",
        description: "codepulse-hook claude",
      },
    ];

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: commands }],
            Notification: { hooks: [IMPORTED_CLAUDE_HOOK] },
          },
          note: "codepulse-hook claude",
        }),
        "utf8",
      );

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(status.codexImportedHooks).toEqual({
        state: "clean",
        hooksPath: fixture.codexHooksPath,
        count: 0,
        eventNames: [],
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("Codex imported Claude hook repair", () => {
  it("removes only matching leaves while preserving containers and unknown fields", async () => {
    const fixture = await createImportedHooksFixture();
    const keepCodex = {
      type: "command",
      command: "/opt/codepulse-hook codex",
      unknownLeafField: true,
    };
    const keepOther = { type: "command", command: "/bin/keep --flag" };
    const config = {
      version: 3,
      unknownTopLevel: { enabled: true },
      hooks: {
        Stop: [
          {
            matcher: "project-*",
            unknownGroupField: { keep: true },
            hooks: [IMPORTED_CLAUDE_HOOK, keepCodex, keepOther],
          },
          { hooks: [IMPORTED_CLAUDE_HOOK] },
          { preexistingEmpty: true, hooks: [] },
        ],
        Notification: [
          { matcher: "notification", hooks: [IMPORTED_CLAUDE_HOOK] },
          { unknownGroupField: 42, hooks: [IMPORTED_CLAUDE_HOOK] },
        ],
        OnlyConflict: [{ hooks: [IMPORTED_CLAUDE_HOOK] }],
        OtherEvent: [{ hooks: [keepOther] }],
        NonArrayEvent: { keep: true },
      },
    };
    const original = `${JSON.stringify(config, null, 2).replaceAll("\n", "\r\n")}\r\n  `;

    try {
      await writeFile(fixture.codexHooksPath, original, "utf8");
      await chmod(fixture.codexHooksPath, 0o640);

      const result = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });
      const repaired = JSON.parse(
        await readFile(fixture.codexHooksPath, "utf8"),
      ) as typeof config;
      const repairedHooks = repaired.hooks as Record<string, unknown>;

      expect(result.removedCount).toBe(5);
      expect(result.eventNames).toEqual([
        "Stop",
        "Notification",
        "OnlyConflict",
      ]);
      expect(result.status.codexImportedHooks.state).toBe("clean");
      expect(result.backupPath).toMatch(
        /hooks\.json\.codepulse-import-\d{8}-\d{6}-\d{3}-[a-zA-Z0-9_-]+\.bak$/,
      );
      expect(await readFile(result.backupPath as string)).toEqual(
        Buffer.from(original),
      );
      expect((await stat(fixture.codexHooksPath)).mode & 0o777).toBe(0o640);
      expect(repaired.version).toBe(3);
      expect(repaired.unknownTopLevel).toEqual({ enabled: true });
      expect(repairedHooks.Stop).toEqual([
        {
          matcher: "project-*",
          unknownGroupField: { keep: true },
          hooks: [keepCodex, keepOther],
        },
        { preexistingEmpty: true, hooks: [] },
      ]);
      expect(repairedHooks.Notification).toEqual([
        { matcher: "notification", hooks: [] },
        { unknownGroupField: 42, hooks: [] },
      ]);
      expect(Object.hasOwn(repairedHooks, "OnlyConflict")).toBe(false);
      expect(repairedHooks.OtherEvent).toEqual([{ hooks: [keepOther] }]);
      expect(repairedHooks.NonArrayEvent).toEqual({ keep: true });
      expect(
        (await readdir(fixture.root)).filter(
          (name) =>
            name.endsWith(".tmp") ||
            name.endsWith(".lock") ||
            name.includes(".stale-"),
        ),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("is idempotent and does not create another backup once clean", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );

      const first = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });
      const afterFirst = await readFile(fixture.codexHooksPath);
      const second = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });
      const backups = (await readdir(fixture.root)).filter((name) =>
        name.endsWith(".bak"),
      );

      expect(first.removedCount).toBe(1);
      expect(second).toMatchObject({
        removedCount: 0,
        eventNames: [],
        status: { codexImportedHooks: { state: "clean" } },
      });
      expect(second.backupPath).toBeUndefined();
      expect(backups).toHaveLength(1);
      expect(await readFile(fixture.codexHooksPath)).toEqual(afterFirst);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not write when hooks.json is missing", async () => {
    const fixture = await createImportedHooksFixture();

    try {
      const result = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(result).toMatchObject({
        removedCount: 0,
        eventNames: [],
        status: { codexImportedHooks: { state: "clean" } },
      });
      expect(result.backupPath).toBeUndefined();
      expect(await readdir(fixture.root)).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not write when hooks.json is invalid", async () => {
    const fixture = await createImportedHooksFixture();
    const original = Buffer.from("{ invalid-json\n");

    try {
      await writeFile(fixture.codexHooksPath, original);

      const result = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(result).toMatchObject({
        removedCount: 0,
        eventNames: [],
        status: { codexImportedHooks: { state: "invalid" } },
      });
      expect(result.backupPath).toBeUndefined();
      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(await readdir(fixture.root)).toEqual(["hooks.json"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(["9007199254740993", "1.0000000000000001", "1e400"])(
    "refuses to repair hooks.json containing the unsafe JSON number %s",
    async (rawNumber) => {
      const fixture = await createImportedHooksFixture();
      const original = Buffer.from(
        `{"unknownNumber":${rawNumber},"hooks":${JSON.stringify(importedHooksConfig().hooks)}}\n`,
      );

      try {
        await writeFile(fixture.codexHooksPath, original);

        await expect(
          repairCodexImportedClaudeHooks({
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          }),
        ).rejects.toThrow(/拒绝自动修复.*手动删除.*改为字符串/);

        expect(await readFile(fixture.codexHooksPath)).toEqual(original);
        expect(await readdir(fixture.root)).toEqual(["hooks.json"]);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it("returns clean when another writer removes the conflict after locking", async () => {
    const fixture = await createImportedHooksFixture();
    const concurrent = Buffer.from(
      '{"unknownNumber":9007199254740993,"hooks":{}}\n',
    );

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );

      const result = await repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          onPhase: async (phase: string) => {
            if (phase === "locked") {
              await writeFile(fixture.codexHooksPath, concurrent);
            }
          },
        },
      );

      expect(result).toMatchObject({
        removedCount: 0,
        eventNames: [],
        status: { codexImportedHooks: { state: "clean" } },
      });
      expect(result.backupPath).toBeUndefined();
      expect(await readFile(fixture.codexHooksPath)).toEqual(concurrent);
      expect(await readdir(fixture.root)).toEqual(["hooks.json"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not repair or back up JSON containing invalid UTF-8", async () => {
    const fixture = await createImportedHooksFixture();
    const original = invalidUtf8ImportedHooksConfig();

    try {
      await writeFile(fixture.codexHooksPath, original);

      const result = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });

      expect(result).toMatchObject({
        removedCount: 0,
        eventNames: [],
        status: { codexImportedHooks: { state: "invalid" } },
      });
      expect(result.backupPath).toBeUndefined();
      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(await readdir(fixture.root)).toEqual(["hooks.json"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports a symlink target conflict but refuses to repair the symlink", async () => {
    const fixture = await createImportedHooksFixture();
    const targetPath = path.join(fixture.root, "target-hooks.json");
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(targetPath, original);
      await symlink(targetPath, fixture.codexHooksPath);

      const status = await getHookInstallStatus({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });
      expect(status.codexImportedHooks.state).toBe("conflict");

      await expect(
        repairCodexImportedClaudeHooks({
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        }),
      ).rejects.toThrow(/符号链接.*target-hooks\.json/);

      expect((await lstat(fixture.codexHooksPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(targetPath)).toEqual(original);
      expect((await readdir(fixture.root)).sort()).toEqual([
        "hooks.json",
        "target-hooks.json",
      ]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("retries an exclusive backup name collision without overwriting it", async () => {
    const fixture = await createImportedHooksFixture();
    const now = Date.UTC(2026, 6, 10, 15, 15, 0, 123);
    const collisionPath = `${fixture.codexHooksPath}.codepulse-import-20260710-151500-123-collision.bak`;
    const nextBackupPath = `${fixture.codexHooksPath}.codepulse-import-20260710-151500-123-next.bak`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));
    let backupTokenCalls = 0;

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(collisionPath, "existing-backup", "utf8");

      const result = await repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          now: () => now,
          randomToken: (purpose: string) => {
            if (purpose === "backup") {
              backupTokenCalls += 1;
              return backupTokenCalls === 1 ? "collision" : "next";
            }
            return `${purpose}-token`;
          },
          isProcessAlive: () => false,
        },
      );

      expect(result.backupPath).toBe(nextBackupPath);
      expect(await readFile(collisionPath, "utf8")).toBe("existing-backup");
      expect(await readFile(nextBackupPath)).toEqual(original);
      expect(backupTokenCalls).toBe(2);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects an active repair lock without changing the config", async () => {
    const fixture = await createImportedHooksFixture();
    const now = Date.UTC(2026, 6, 10, 15, 15, 0, 123);
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, createdAt: now, token: "owner" }),
        "utf8",
      );

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            now: () => now,
            randomToken: (purpose: string) => `${purpose}-token`,
            isProcessAlive: () => true,
          },
        ),
      ).rejects.toThrow(/修复正在进行|稍后重试/);
      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual({
        pid: process.pid,
        createdAt: now,
        token: "owner",
      });
      expect(
        (await readdir(fixture.root)).filter((name) => name.endsWith(".bak")),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps a valid live lock active even when createdAt is expired", async () => {
    const fixture = await createImportedHooksFixture();
    const now = Date.now();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));
    const expiredCreatedAt = now - 365 * 24 * 60 * 60 * 1_000;

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          createdAt: expiredCreatedAt,
          token: "live-owner",
        }),
        "utf8",
      );

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            now: () => now,
            randomToken: (purpose: string) => `${purpose}-token`,
            isProcessAlive: () => true,
          },
        ),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
        token: "live-owner",
        createdAt: expiredCreatedAt,
      });
      expect(
        (await readdir(fixture.root)).filter((name) => name.endsWith(".bak")),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a fresh invalid lock instead of taking it over", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(lockPath, "", "utf8");

      await expect(
        repairCodexImportedClaudeHooks({
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        }),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(await readFile(lockPath, "utf8")).toBe("");
      expect(
        (await readdir(fixture.root)).filter((name) => name.endsWith(".bak")),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("treats an invalid lock with old mtime but fresh ctime as busy", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1_000);

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );
      await writeFile(lockPath, "", "utf8");
      await utimes(lockPath, old, old);

      await expect(
        repairCodexImportedClaudeHooks({
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        }),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      expect(await readFile(lockPath, "utf8")).toBe("");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not take over a lock while its owner is paused before writing the token", async () => {
    const fixture = await createImportedHooksFixture();
    let announceOpen: (() => void) | undefined;
    let resumeFirst: (() => void) | undefined;
    let reachedOpenPhase = false;
    const opened = new Promise<void>((resolve) => {
      announceOpen = resolve;
    });
    const firstCanWrite = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );

      const first = repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          onPhase: async (phase: string) => {
            if (phase === "after-lock-open") {
              reachedOpenPhase = true;
              announceOpen?.();
              await firstCanWrite;
            }
          },
        },
      );

      await opened;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));

      await expect(
        repairCodexImportedClaudeHooks({
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        }),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      resumeFirst?.();
      const result = await first;
      expect(reachedOpenPhase).toBe(true);
      expect(result.removedCount).toBe(1);
    } finally {
      resumeFirst?.();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("cleans its own lock when initialization fails after writing the record", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(fixture.codexHooksPath, original);

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            randomToken: (purpose: string) => `${purpose}-failed`,
            onPhase: (phase: string) => {
              if (phase === "after-lock-write") {
                throw new Error("synthetic lock initialization failure");
              }
            },
          },
        ),
      ).rejects.toThrow("synthetic lock initialization failure");

      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(
        (await readdir(fixture.root)).filter(
          (name) =>
            name.endsWith(".lock") ||
            name.endsWith(".bak") ||
            name.endsWith(".tmp"),
        ),
      ).toEqual([]);

      const retry = await repairCodexImportedClaudeHooks({
        supportPath: fixture.supportPath,
        codexHooksPath: fixture.codexHooksPath,
      });
      expect(retry.removedCount).toBe(1);
      expect(retry.status.codexImportedHooks.state).toBe("clean");
      expect(await readFile(lockPath, "utf8").catch(() => undefined)).toBe(
        undefined,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not delete a later owner when after-lock-open replaces the path", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const laterPath = path.join(fixture.root, "later-initializer.lock");
    const laterRecord = {
      pid: process.pid,
      createdAt: Date.now(),
      token: "later-initializer",
    };

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );
      await writeFile(laterPath, JSON.stringify(laterRecord), "utf8");

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            onPhase: async (phase: string) => {
              if (phase === "after-lock-open") {
                await rename(laterPath, lockPath);
                throw new Error("synthetic replaced initializer");
              }
            },
          },
        ),
      ).rejects.toThrow("synthetic replaced initializer");

      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(laterRecord);
      expect(
        (await readdir(fixture.root)).filter((name) => name.endsWith(".bak")),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("allows only the first of two concurrent repairs to hold the lock", async () => {
    const fixture = await createImportedHooksFixture();
    let announceLocked: (() => void) | undefined;
    let resumeFirst: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      announceLocked = resolve;
    });
    const firstCanContinue = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );

      const first = repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          onPhase: async (phase: string) => {
            if (phase === "locked") {
              announceLocked?.();
              await firstCanContinue;
            }
          },
        },
      );

      await locked;
      await expect(
        repairCodexImportedClaudeHooks({
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        }),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      resumeFirst?.();
      const result = await first;
      expect(result.removedCount).toBe(1);
      expect(result.status.codexImportedHooks.state).toBe("clean");
    } finally {
      resumeFirst?.();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rechecks a stale candidate before taking over the lock", async () => {
    const fixture = await createImportedHooksFixture();
    const now = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(lockPath, "not-json", "utf8");

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            now: () => now,
            randomToken: (purpose: string) => `${purpose}-token`,
            isProcessAlive: () => true,
            onPhase: async (phase: string) => {
              if (phase === "before-stale-takeover") {
                await writeFile(
                  lockPath,
                  JSON.stringify({
                    pid: process.pid,
                    createdAt: now,
                    token: "initialized-owner",
                  }),
                  "utf8",
                );
              }
            },
          },
        ),
      ).rejects.toThrow(/修复正在进行|稍后重试/);

      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
        token: "initialized-owner",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it.each(["dead", "invalid"] as const)(
    "takes over a %s stale repair lock",
    async (scenario) => {
      const fixture = await createImportedHooksFixture();
      const now = Date.now() + 365 * 24 * 60 * 60 * 1_000;
      const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;

      try {
        await writeFile(
          fixture.codexHooksPath,
          JSON.stringify(importedHooksConfig()),
          "utf8",
        );
        await writeFile(
          lockPath,
          scenario === "invalid"
            ? "not-json"
            : JSON.stringify({
                pid: 99_999_999,
                createdAt: now,
                token: "stale-owner",
              }),
          "utf8",
        );

        const result = await repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            now: () => now,
            randomToken: (purpose: string) => `${purpose}-token`,
            isProcessAlive: () => scenario !== "dead",
          },
        );

        expect(result.removedCount).toBe(1);
        expect(result.status.codexImportedHooks.state).toBe("clean");
        expect(
          (await readdir(fixture.root)).filter(
            (name) => name.endsWith(".lock") || name.includes(".stale-"),
          ),
        ).toEqual([]);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it("does not release a lock whose token was replaced by a later owner", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );

      const result = await repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          randomToken: (purpose: string) => `${purpose}-owner`,
          onPhase: async (phase: string) => {
            if (phase === "before-release") {
              await writeFile(
                lockPath,
                JSON.stringify({
                  pid: process.pid,
                  createdAt: Date.now(),
                  token: "later-owner",
                }),
                "utf8",
              );
            }
          },
        },
      );

      expect(result.removedCount).toBe(1);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
        token: "later-owner",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not unlink a later lock replaced after the release handle read", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const laterLockPath = path.join(fixture.root, "later-owner.lock");

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );
      await writeFile(
        laterLockPath,
        JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
          token: "later-path-owner",
        }),
        "utf8",
      );

      const result = await repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          randomToken: (purpose: string) => `${purpose}-owner`,
          onPhase: async (phase: string) => {
            if (phase === "before-release-path-stat") {
              await rename(laterLockPath, lockPath);
            }
          },
        },
      );

      expect(result.removedCount).toBe(1);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
        token: "later-path-owner",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not release a same-token lock with a different inode", async () => {
    const fixture = await createImportedHooksFixture();
    const lockPath = `${fixture.codexHooksPath}.codepulse-import.lock`;
    const laterLockPath = path.join(fixture.root, "same-token-later.lock");
    const laterRecord = {
      pid: process.pid,
      createdAt: Date.now(),
      token: "lock-owner",
    };

    try {
      await writeFile(
        fixture.codexHooksPath,
        JSON.stringify(importedHooksConfig()),
        "utf8",
      );
      await writeFile(laterLockPath, JSON.stringify(laterRecord), "utf8");

      const result = await repairCodexImportedClaudeHooks(
        {
          supportPath: fixture.supportPath,
          codexHooksPath: fixture.codexHooksPath,
        },
        {
          randomToken: (purpose: string) => `${purpose}-owner`,
          onPhase: async (phase: string) => {
            if (phase === "before-release") {
              await rename(laterLockPath, lockPath);
            }
          },
        },
      );

      expect(result.removedCount).toBe(1);
      expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(laterRecord);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("aborts when the config content changes before commit", async () => {
    const fixture = await createImportedHooksFixture();
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));
    const concurrent = Buffer.from(
      JSON.stringify({ hooks: {}, concurrentWriter: true }),
    );

    try {
      await writeFile(fixture.codexHooksPath, original);

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            randomToken: (purpose: string) => `${purpose}-token`,
            onPhase: async (phase: string) => {
              if (phase === "before-commit") {
                await writeFile(fixture.codexHooksPath, concurrent);
              }
            },
          },
        ),
      ).rejects.toThrow(/配置已变化|刷新后重试/);

      expect(await readFile(fixture.codexHooksPath)).toEqual(concurrent);
      const files = await readdir(fixture.root);
      const backups = files.filter((name) => name.endsWith(".bak"));
      expect(backups).toHaveLength(1);
      expect(await readFile(path.join(fixture.root, backups[0]))).toEqual(
        original,
      );
      expect(
        files.filter(
          (name) =>
            name.endsWith(".tmp") ||
            name.endsWith(".lock") ||
            name.includes(".stale-"),
        ),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("aborts when only the config stat signature changes before commit", async () => {
    const fixture = await createImportedHooksFixture();
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));

    try {
      await writeFile(fixture.codexHooksPath, original);

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            randomToken: (purpose: string) => `${purpose}-token`,
            onPhase: async (phase: string) => {
              if (phase === "before-commit") {
                const future = new Date(Date.now() + 60_000);
                await utimes(fixture.codexHooksPath, future, future);
              }
            },
          },
        ),
      ).rejects.toThrow(/配置已变化|刷新后重试/);

      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      const files = await readdir(fixture.root);
      expect(files.filter((name) => name.endsWith(".bak"))).toHaveLength(1);
      expect(
        files.filter(
          (name) =>
            name.endsWith(".tmp") ||
            name.endsWith(".lock") ||
            name.includes(".stale-"),
        ),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("aborts when the path is atomically replaced after the file handle read", async () => {
    const fixture = await createImportedHooksFixture();
    const replacementPath = path.join(fixture.root, "replacement.json");
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));
    let replaced = false;

    try {
      await writeFile(fixture.codexHooksPath, original);
      await writeFile(replacementPath, original);

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            randomToken: (purpose: string) => `${purpose}-token`,
            onPhase: async (phase: string) => {
              if (phase === "before-final-path-stat" && !replaced) {
                replaced = true;
                await rename(replacementPath, fixture.codexHooksPath);
              }
            },
          },
        ),
      ).rejects.toThrow(/配置已变化|刷新后重试/);

      expect(replaced).toBe(true);
      expect(await readFile(fixture.codexHooksPath)).toEqual(original);
      const files = await readdir(fixture.root);
      expect(files.filter((name) => name.endsWith(".bak"))).toHaveLength(1);
      expect(
        files.filter(
          (name) =>
            name.endsWith(".tmp") ||
            name.endsWith(".lock") ||
            name.includes(".stale-"),
        ),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("aborts without replacing a symlink introduced before commit", async () => {
    const fixture = await createImportedHooksFixture();
    const targetPath = path.join(fixture.root, "linked-target.json");
    const original = Buffer.from(JSON.stringify(importedHooksConfig()));
    let replacedWithSymlink = false;

    try {
      await writeFile(fixture.codexHooksPath, original);
      await link(fixture.codexHooksPath, targetPath);

      await expect(
        repairCodexImportedClaudeHooks(
          {
            supportPath: fixture.supportPath,
            codexHooksPath: fixture.codexHooksPath,
          },
          {
            randomToken: (purpose: string) => `${purpose}-token`,
            onPhase: async (phase: string) => {
              if (phase === "before-final-path-stat" && !replacedWithSymlink) {
                replacedWithSymlink = true;
                await unlink(fixture.codexHooksPath);
                await symlink(targetPath, fixture.codexHooksPath);
              }
            },
          },
        ),
      ).rejects.toThrow(/符号链接|配置已变化|刷新后重试/);

      expect(replacedWithSymlink).toBe(true);
      expect((await lstat(fixture.codexHooksPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(targetPath)).toEqual(original);
      const files = await readdir(fixture.root);
      expect(files.filter((name) => name.endsWith(".bak"))).toHaveLength(1);
      expect(
        files.filter(
          (name) =>
            name.endsWith(".tmp") ||
            name.endsWith(".lock") ||
            name.includes(".stale-"),
        ),
      ).toEqual([]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("Codex notify force-overwrite restore flow", () => {
  it("restores the user's original notify on uninstall after a forced overwrite", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codepulse-codex-"));
    const supportPath = path.join(root, "support");
    const notifyBackupRoot = path.join(root, "codepulse");
    const codexConfigPath = path.join(root, "config.toml");
    const codexHooksPath = path.join(root, "hooks.json");
    const original =
      'model = "gpt-5.5"\nnotify = ["/opt/computer-use", "turn-ended"]\n\n[tui]\n';

    try {
      await writeFile(codexConfigPath, original, "utf8");

      // 非 force 安装应因既有 notify 抛冲突，且不改动配置。
      await expect(
        installHooks(
          {
            supportPath,
            codexConfigPath,
            codexHooksPath,
            notifyBackupRoot,
          },
          "codex",
        ),
      ).rejects.toBeInstanceOf(CodexNotifyConflictError);
      expect(await readFile(codexConfigPath, "utf8")).toBe(original);

      // force 安装应写入 CodePulse notify，并备份被顶掉的原 notify。
      await installHooks(
        { supportPath, codexConfigPath, codexHooksPath, notifyBackupRoot },
        "codex",
        { force: true },
      );
      const afterInstall = await readFile(codexConfigPath, "utf8");
      expect(afterInstall).toContain("codepulse-hook");
      expect(afterInstall).not.toContain("/opt/computer-use");

      // 卸载应还原用户原本的 notify，而不是留空。
      await uninstallHooks(
        { supportPath, codexConfigPath, codexHooksPath, notifyBackupRoot },
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
