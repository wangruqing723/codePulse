import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FloatingViewModel } from "./view-model";

type RendererModule = typeof import("./renderer");

async function loadRendererModule(): Promise<Partial<RendererModule>> {
  try {
    return await import("./renderer");
  } catch {
    return {};
  }
}

function readStyles(): string {
  return readFileSync("src/companion/styles.css", "utf8");
}

function createModel(overrides: Partial<FloatingViewModel>): FloatingViewModel {
  return {
    status: "running",
    count: 1,
    isPinned: true,
    text: "运行中 1 个",
    sessions: [
      {
        session: {
          id: "codex:1",
          agent: "codex",
          status: "running",
          source: "passive",
          cwd: "/tmp/project",
          projectName: "project",
          title: "修复 companion",
          updatedAt: "2026-07-03T12:00:00.000Z",
        },
        copyActions: [
          {
            id: "copy-local-path",
            label: "复制路径",
            value: "/tmp/project",
          },
        ],
        displayStatus: "running",
        statusTone: "green",
        contextText: "等待用户确认",
        durationText: "02:14",
        displayPath: "~/project",
        fullPath: "/tmp/project",
        copyAction: {
          id: "copy-local-path",
          label: "复制路径",
          value: "/tmp/project",
        },
      },
    ],
    ...overrides,
  };
}

describe("companion renderer html", () => {
  it("renders aggregate status, controls, sessions, and copy actions", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({}));

    expect(html).toContain("运行中 1 个");
    expect(html).toContain('data-action="pin"');
    expect(html).toContain('data-action="minimize"');
    expect(html).toContain('data-action="close"');
    expect(html).not.toContain('data-action="hide"');
    expect(html).not.toContain('data-action="force-exit"');
    expect(html).toContain('aria-label="置顶"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-label="最小化"');
    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain('class="status-dot"');
    expect(html).toContain('class="session-path-row"');
    expect(html).toContain('title="/tmp/project"');
    expect(html).toContain("修复 companion");
    expect(html).toContain('title="复制路径"');
    expect(html).toContain('class="copy-icon"');
    expect(html).not.toContain(">复制路径</button>");
    expect(html).toContain("等待用户确认");
    expect(html).toContain("02:14");
  });

  it("renders compact icon-only window actions", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({}));

    expect(html).toContain('class="window-icon window-icon-pin pin-solid"');
    expect(html).toContain('aria-hidden="true">−</span>');
    expect(html).toContain('aria-hidden="true">×</span>');
    expect(html).not.toContain('data-action="pin">置顶</button>');
    expect(html).not.toContain('data-action="minimize">最小化</button>');
    expect(html).not.toContain('data-action="close">关闭</button>');
  });

  it("renders inactive pin as an unpressed outline control", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({ isPinned: false }));

    expect(html).toContain('data-action="pin"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-active="false"');
    expect(html).toContain('class="window-icon window-icon-pin pin-outline"');
    expect(html).not.toContain('class="window-icon window-icon-pin pin-solid"');
  });

  it("handles clicks on nested window action icons", async () => {
    const { bindInteractions } = await loadRendererModule();
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    const requestWindowAction = vi.fn();
    class FakeElement {
      constructor(
        public dataset: Record<string, string | undefined> = {},
        private closestElement?: FakeElement,
      ) {}

      closest(): FakeElement | undefined {
        return this.closestElement;
      }
    }
    const root = {
      addEventListener: vi.fn(
        (event: string, listener: (event: { target: unknown }) => void) => {
          listeners.set(event, listener);
        },
      ),
    };
    const button = new FakeElement({ action: "pin" });
    const icon = new FakeElement({}, button);

    vi.stubGlobal("HTMLElement", FakeElement);
    bindInteractions?.(
      root as never,
      {
        copyText: vi.fn(),
        getState: vi.fn(),
        requestWindowAction,
        subscribe: vi.fn(),
      } as never,
    );
    listeners.get("click")?.({ target: icon });

    expect(requestWindowAction.mock.calls).toEqual([["pin"]]);
    vi.unstubAllGlobals();
  });

  it("copies paths through navigator clipboard when the copy icon is clicked", async () => {
    const { bindInteractions } = await loadRendererModule();
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    const writeText = vi.fn(async () => undefined);
    const copyText = vi.fn(async () => undefined);
    class FakeElement {
      constructor(
        public dataset: Record<string, string | undefined> = {},
        private closestElement?: FakeElement,
      ) {}

      closest(): FakeElement | undefined {
        return this.closestElement;
      }
    }
    const root = {
      addEventListener: vi.fn(
        (event: string, listener: (event: { target: unknown }) => void) => {
          listeners.set(event, listener);
        },
      ),
    };
    const button = new FakeElement({ copyValue: "/tmp/project" });
    const icon = new FakeElement({}, button);

    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
      },
    });
    bindInteractions?.(
      root as never,
      {
        copyText,
        getState: vi.fn(),
        requestWindowAction: vi.fn(),
        subscribe: vi.fn(),
      } as never,
    );
    await listeners.get("click")?.({ target: icon });

    expect(writeText).toHaveBeenCalledWith("/tmp/project");
    expect(copyText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("briefly marks the copy button as copied after clipboard succeeds", async () => {
    vi.useFakeTimers();
    const { bindInteractions } = await loadRendererModule();
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    const writeText = vi.fn(async () => undefined);
    class FakeElement {
      constructor(
        public dataset: Record<string, string | undefined> = {},
        private closestElement?: FakeElement,
      ) {}

      closest(): FakeElement | undefined {
        return this.closestElement;
      }
    }
    const root = {
      addEventListener: vi.fn(
        (event: string, listener: (event: { target: unknown }) => void) => {
          listeners.set(event, listener);
        },
      ),
    };
    const button = new FakeElement({ copyValue: "/tmp/project" });
    const icon = new FakeElement({}, button);

    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText,
      },
    });
    bindInteractions?.(
      root as never,
      {
        copyText: vi.fn(),
        getState: vi.fn(),
        requestWindowAction: vi.fn(),
        subscribe: vi.fn(),
      } as never,
    );
    await listeners.get("click")?.({ target: icon });

    expect(button.dataset.copied).toBe("true");

    vi.advanceTimersByTime(899);
    expect(button.dataset.copied).toBe("true");

    vi.advanceTimersByTime(1);
    expect(button.dataset.copied).toBeUndefined();

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not render a visual drag handle in the header", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({}));

    expect(html).toContain('<header class="header">');
    expect(html).not.toContain('<header class="header drag-region">');
    expect(html).not.toContain("drag-handle");
    expect(html).not.toContain("drag-region");
  });

  it("renders unavailable detail and empty state text", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const unavailableHtml = renderFloatingHtml?.(
      createModel({
        status: "unavailable",
        count: 0,
        text: "WSL 不可用",
        unavailableReason: "wsl.exe exited with code 1",
        sessions: [],
      }),
    );
    const emptyHtml = renderFloatingHtml?.(
      createModel({
        status: "empty",
        count: 0,
        text: "暂无活跃会话",
        sessions: [],
      }),
    );

    expect(unavailableHtml).toContain("WSL 不可用");
    expect(unavailableHtml).toContain("wsl.exe exited with code 1");
    expect(emptyHtml).toContain("暂无活跃会话");
  });

  it("does not render a status dot tone for legacy idle session cards", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(
      createModel({
        sessions: [
          {
            session: {
              id: "codex:idle",
              agent: "codex",
              status: "idle",
              source: "passive",
              cwd: "/tmp/project",
              projectName: "project",
              title: "空闲会话",
              updatedAt: "2026-07-03T12:00:00.000Z",
            },
            copyActions: [],
          } as never,
        ],
      }),
    );

    expect(html).not.toContain('data-status="idle"');
    expect(html).not.toContain('class="status-dot"');
  });

  it("renders structured one-line header status summary items", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(
      createModel({
        text: "🟢 1 运行中  🔵 1 完成",
        summaryItems: [
          { status: "running", statusTone: "green", count: 1, label: "运行中" },
          { status: "done", statusTone: "blue", count: 1, label: "完成" },
        ],
      }),
    );

    expect(html).toContain('class="status-text status-summary"');
    expect(html).toContain('data-tone="green"');
    expect(html).toContain('data-tone="blue"');
    expect(html).toContain('class="summary-dot"');
    expect(html).toContain('class="summary-count">1</span>');
    expect(html).toContain('class="summary-label">运行中</span>');
    expect(html).toContain('class="summary-label">完成</span>');
  });

  it("does not repeat the card title in the footer when context is empty", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(
      createModel({
        sessions: [
          {
            session: {
              id: "codex:1",
              agent: "codex",
              status: "running",
              source: "passive",
              cwd: "/tmp/plugin-todolist",
              projectName: "plugin-todolist",
              title: "plugin-todolist",
              updatedAt: "2026-07-03T12:00:00.000Z",
            },
            copyActions: [],
            displayStatus: "running",
            statusTone: "green",
            durationText: "13:50",
          },
        ],
      }),
    );

    expect(html?.match(/plugin-todolist/g)).toHaveLength(1);
    expect(html).toContain('class="session-duration">13:50</time>');
  });

  it("renders session cards as a compact two-row layout", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(
      createModel({
        sessions: [
          {
            session: {
              id: "codex:1",
              agent: "codex",
              status: "done",
              source: "passive",
              cwd: "/tmp/codePulse",
              projectName: "codePulse",
              title: "codePulse",
              updatedAt: "2026-07-03T12:00:00.000Z",
            },
            copyActions: [
              {
                id: "copy-local-path",
                label: "复制路径",
                value: "/tmp/codePulse",
              },
            ],
            displayStatus: "done",
            statusTone: "blue",
            durationText: "27:09",
            displayPath: "~/codePulse",
            fullPath: "/tmp/codePulse",
          },
        ],
      }),
    );

    const topRowStart = html?.indexOf('class="session-top-row"') ?? -1;
    const titleGroupStart = html?.indexOf('class="session-title-group"') ?? -1;
    const titleStart = html?.indexOf('class="session-title"') ?? -1;
    const metaStart = html?.indexOf('class="session-meta"') ?? -1;
    const agentStart = html?.indexOf('class="session-agent"') ?? -1;
    const separatorStart =
      html?.indexOf('class="session-meta-separator"') ?? -1;
    const durationStart = html?.indexOf('class="session-duration"') ?? -1;
    const pathRowStart = html?.indexOf('class="session-path-row"') ?? -1;

    expect(topRowStart).toBeGreaterThan(-1);
    expect(titleGroupStart).toBeGreaterThan(topRowStart);
    expect(titleStart).toBeGreaterThan(titleGroupStart);
    expect(metaStart).toBeGreaterThan(titleStart);
    expect(agentStart).toBeGreaterThan(metaStart);
    expect(separatorStart).toBeGreaterThan(agentStart);
    expect(durationStart).toBeGreaterThan(separatorStart);
    expect(pathRowStart).toBeGreaterThan(durationStart);
    expect(html).not.toContain("session-heading");
    expect(html).not.toContain("session-agent-group");
    expect(html).not.toContain("session-context-row");
  });
});

describe("companion renderer css", () => {
  it("keeps nested icons from intercepting button clicks", () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.window-icon,\s*\.copy-icon[^{]*{\s*[^}]*pointer-events:\s*none;/,
    );
  });

  it("keeps session cards compact without fixed vertical stretching", () => {
    const css = readStyles();
    const sessionItemRule = css.match(/\.session-item\s*{(?<body>[^}]*)}/)
      ?.groups?.body;

    expect(sessionItemRule).toContain("display: flex;");
    expect(sessionItemRule).toContain("flex-direction: column;");
    expect(sessionItemRule).toContain("gap: 4px;");
    expect(sessionItemRule).toContain("height: fit-content;");
    expect(sessionItemRule).toContain("padding: 12px 16px;");
    expect(sessionItemRule).not.toContain("min-height");
    expect(sessionItemRule).not.toContain("flex: 1");
    expect(sessionItemRule).not.toContain("flex-grow");
    expect(sessionItemRule).not.toContain("justify-content: space-between");
  });

  it("keeps the session list from stretching card rows", () => {
    const css = readStyles();
    const sessionListRule = css.match(/\.session-list\s*{(?<body>[^}]*)}/)
      ?.groups?.body;

    expect(sessionListRule).toContain("gap: 8px;");
    expect(sessionListRule).toContain("align-content: flex-start;");
    expect(sessionListRule).toContain("align-items: start;");
    expect(sessionListRule).toContain("grid-auto-rows: max-content;");
  });

  it("vertically centers both rows in each compact card", () => {
    const css = readStyles();
    const topRowRule = css.match(/\.session-top-row\s*{(?<body>[^}]*)}/)?.groups
      ?.body;
    const titleGroupRule = css.match(/\.session-title-group\s*{(?<body>[^}]*)}/)
      ?.groups?.body;
    const metaRule = css.match(/\.session-meta\s*{(?<body>[^}]*)}/)?.groups
      ?.body;
    const pathRowRule = css.match(/\.session-path-row\s*{(?<body>[^}]*)}/)
      ?.groups?.body;

    expect(topRowRule).toContain("align-items: center;");
    expect(titleGroupRule).toContain("align-items: center;");
    expect(metaRule).toContain("align-items: center;");
    expect(pathRowRule).toContain("align-items: center;");
  });

  it("uses muted 12px path text and subtle hover backgrounds", () => {
    const css = readStyles();
    const pathRule = css.match(/\.session-path\s*{(?<body>[^}]*)}/)?.groups
      ?.body;

    expect(pathRule).toContain("font-size: 12px;");
    expect(pathRule).toContain("color: rgba(255, 255, 255, 0.45);");
    expect(css).toMatch(
      /\.window-button:hover,\s*\.copy-action:hover\s*{[^}]*background(?:-color)?:\s*rgba\(255,\s*255,\s*255,\s*0\.1\);/,
    );
  });

  it("animates copy success without adding layout weight", () => {
    const css = readStyles();

    expect(css).toContain('.copy-action[data-copied="true"]');
    expect(css).toMatch(
      /\.copy-action\[data-copied="true"\]\s*{[^}]*animation:\s*copy-success/,
    );
    expect(css).toContain("@keyframes copy-success");
  });
});

describe("companion renderer hover intent", () => {
  it("delays hover-leave hide and cancels it when hover re-enters quickly", async () => {
    vi.useFakeTimers();
    const { createHoverIntentController } = await loadRendererModule();
    const requestWindowAction = vi.fn();

    const hover = createHoverIntentController?.(
      {
        requestWindowAction,
      } as never,
      { hideDelayMs: 180 },
    );

    hover?.onPointerEnter();
    hover?.onPointerLeave();
    vi.advanceTimersByTime(120);
    hover?.onPointerEnter();
    vi.advanceTimersByTime(120);

    expect(requestWindowAction.mock.calls).toEqual([
      ["hover-enter"],
      ["hover-enter"],
    ]);
    vi.useRealTimers();
  });

  it("fires hover-leave only after the delay elapses", async () => {
    vi.useFakeTimers();
    const { createHoverIntentController } = await loadRendererModule();
    const requestWindowAction = vi.fn();

    const hover = createHoverIntentController?.(
      {
        requestWindowAction,
      } as never,
      { hideDelayMs: 180 },
    );

    hover?.onPointerLeave();
    vi.advanceTimersByTime(179);
    expect(requestWindowAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(requestWindowAction.mock.calls).toEqual([["hover-leave"]]);
    vi.useRealTimers();
  });

  it("cancels pending hover-leave when minimize is triggered", async () => {
    vi.useFakeTimers();
    const { createHoverIntentController } = await loadRendererModule();
    const requestWindowAction = vi.fn();

    const hover = createHoverIntentController?.(
      {
        requestWindowAction,
      } as never,
      { hideDelayMs: 180 },
    ) as
      | {
          onPointerLeave?: () => void;
          onWindowAction?: (action: "pin" | "minimize" | "close") => void;
        }
      | undefined;

    hover?.onPointerLeave?.();
    hover?.onWindowAction?.("minimize");
    vi.advanceTimersByTime(180);

    expect(requestWindowAction.mock.calls).toEqual([["minimize"]]);
    vi.useRealTimers();
  });

  it("requests close as an immediate window action", async () => {
    vi.useFakeTimers();
    const { createHoverIntentController } = await loadRendererModule();
    const requestWindowAction = vi.fn();

    const hover = createHoverIntentController?.(
      {
        requestWindowAction,
      } as never,
      { hideDelayMs: 180 },
    ) as
      | {
          onPointerLeave?: () => void;
          onWindowAction?: (action: "pin" | "minimize" | "close") => void;
        }
      | undefined;

    hover?.onPointerLeave?.();
    hover?.onWindowAction?.("close");
    vi.advanceTimersByTime(180);

    expect(requestWindowAction.mock.calls).toEqual([["close"]]);
    vi.useRealTimers();
  });

  it("ignores mouseleave generated after minimize is triggered", async () => {
    vi.useFakeTimers();
    const { createHoverIntentController } = await loadRendererModule();
    const requestWindowAction = vi.fn();

    const hover = createHoverIntentController?.(
      {
        requestWindowAction,
      } as never,
      { hideDelayMs: 180 },
    ) as
      | {
          onPointerLeave?: () => void;
          onWindowAction?: (action: "pin" | "minimize" | "close") => void;
        }
      | undefined;

    hover?.onWindowAction?.("minimize");
    hover?.onPointerLeave?.();
    vi.advanceTimersByTime(180);

    expect(requestWindowAction.mock.calls).toEqual([["minimize"]]);
    vi.useRealTimers();
  });
});
