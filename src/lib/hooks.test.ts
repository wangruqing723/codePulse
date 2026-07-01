import { describe, expect, it } from "vitest";
import {
  buildClaudeHookCommand,
  removeCodePulseClaudeHook,
  removeCodePulseCodexNotify,
  upsertCodePulseClaudeHook,
  upsertCodePulseCodexNotify,
} from "./hooks";

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

  it("replaces an existing top-level notify command", () => {
    const next = upsertCodePulseCodexNotify(
      'model = "gpt-5.5"\nnotify = ["/bin/true"]\n\n[tui]\n',
      SCRIPT_PATH,
    );

    expect(next).toBe(`model = "gpt-5.5"\n${NOTIFY_LINE}\n\n[tui]\n`);
  });

  it("removes CodePulse notify lines from any TOML table", () => {
    const next = removeCodePulseCodexNotify(
      `model = "gpt-5.5"\n\n[mcp_servers]\n${NOTIFY_LINE}\n`,
    );

    expect(next).toBe('model = "gpt-5.5"\n\n[mcp_servers]\n');
  });
});
