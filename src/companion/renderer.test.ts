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

function resolvedClassDeclarations(
  css: string,
  classNames: string[],
): Record<string, string> {
  const declarations: Record<string, string> = {};
  const rulePattern = /([^{}]+)\{([^{}]*)}/g;

  for (const match of css.matchAll(rulePattern)) {
    const selectors = match[1]?.split(",") ?? [];
    const body = match[2] ?? "";
    const applies = selectors.some((selector) => {
      const normalized = selector.trim();
      if (!/^(\.[a-z0-9-]+)+$/i.test(normalized)) {
        return false;
      }

      const requiredClasses = Array.from(
        normalized.matchAll(/\.([a-z0-9-]+)/gi),
        (classMatch) => classMatch[1],
      );
      return requiredClasses.every((className) =>
        classNames.includes(className),
      );
    });

    if (!applies) {
      continue;
    }

    for (const declaration of body.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) {
        continue;
      }

      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property && value) {
        declarations[property] = value;
      }
    }
  }

  return declarations;
}

interface ContentHeightFixtureOptions {
  shellHeight: number;
  headerHeight: number;
  content: "sessions" | "empty";
  childRects: Array<{ top: number; bottom: number }>;
  listScrollHeight?: number;
  listClientHeight?: number;
}

function createContentHeightFixture(options: ContentHeightFixtureOptions): {
  root: HTMLElement;
} {
  const children = options.childRects.map(({ top, bottom }) => ({
    getBoundingClientRect: () => ({
      top,
      bottom,
      height: bottom - top,
    }),
  }));
  const content = {
    scrollHeight: options.listScrollHeight ?? 0,
    clientHeight: options.listClientHeight ?? 0,
    firstElementChild: children[0] ?? null,
    lastElementChild: children.at(-1) ?? null,
  };
  const shell = {
    scrollHeight: options.shellHeight,
  };
  const header = {
    getBoundingClientRect: () => ({
      top: 12,
      bottom: 12 + options.headerHeight,
      height: options.headerHeight,
    }),
  };
  const root = {
    scrollHeight: options.shellHeight,
    querySelector: (selector: string) => {
      if (selector === ".shell") return shell;
      if (selector === ".header") return header;
      if (selector === ".session-list" && options.content === "sessions") {
        return content;
      }
      if (selector === ".empty-state" && options.content === "empty") {
        return content;
      }
      return null;
    },
  };

  return { root: root as never };
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
  it("defaults an omitted presentation to the existing panel", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({ presentation: undefined }));

    expect(html).toContain('data-presentation="panel"');
    expect(html).toContain('<header class="header">');
    expect(html).toContain('class="session-list"');
    expect(html).not.toContain('class="badge no-drag"');
  });

  it("renders a compact status badge without panel content", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(
      createModel({
        presentation: "badge",
        badge: {
          status: "error",
          tone: "red",
          totalCount: 3,
          label: "3 个活跃会话",
        },
      }),
    );

    expect(html).toContain('class="shell shell-badge"');
    expect(html).toContain('data-presentation="badge"');
    expect(html).toContain('class="badge no-drag"');
    expect(html).toContain('data-reveal="true"');
    expect(html).toContain('data-status="error"');
    expect(html).toContain('data-tone="red"');
    expect(html).toContain('aria-label="3 个活跃会话"');
    expect(html).toContain('class="badge-ring"');
    expect(html).toContain('class="badge-count" aria-hidden="true">3</span>');
    expect(html).not.toContain('<header class="header">');
    expect(html).not.toContain('class="session-list"');
    expect(html).not.toContain('class="window-actions no-drag"');
  });

  it("labels delegated Codex session cards", async () => {
    const { renderFloatingHtml } = await loadRendererModule();
    const model = createModel({});
    model.sessions[0]!.session = {
      ...model.sessions[0]!.session,
      origin: "delegated",
    } as (typeof model.sessions)[0]["session"];

    const html = renderFloatingHtml?.(model);

    expect(html).toContain("Codex（Claude Code 委托）");
  });

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

  it("reveals the panel when the badge is clicked", async () => {
    const { bindInteractions } = await loadRendererModule();
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    const requestWindowAction = vi.fn();
    class FakeElement {
      public dataset = { reveal: "true" };

      closest(selector: string): FakeElement | undefined {
        return selector === "[data-reveal]" ? this : undefined;
      }
    }
    const root = {
      addEventListener: vi.fn(
        (event: string, listener: (event: { target: unknown }) => void) => {
          listeners.set(event, listener);
        },
      ),
    };
    const badge = new FakeElement();

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
    listeners.get("click")?.({ target: badge });

    expect(requestWindowAction.mock.calls).toEqual([["hover-enter"]]);
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

describe("companion renderer content height", () => {
  it("does not schedule a content-height report for the badge", async () => {
    const { renderIntoRoot } = await loadRendererModule();
    const requestAnimationFrame = vi.fn();
    const reportContentHeight = vi.fn();
    const root = {
      innerHTML: "",
    };

    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    try {
      renderIntoRoot?.(root as never, createModel({ presentation: "badge" }), {
        reportContentHeight,
      });

      expect(requestAnimationFrame).not.toHaveBeenCalled();
      expect(reportContentHeight).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores a stale panel measurement after switching to the badge", async () => {
    const { renderIntoRoot } = await loadRendererModule();
    const animationFrames: Array<() => void> = [];
    const reportContentHeight = vi.fn();
    let presentation = "panel";
    const root = {
      set innerHTML(html: string) {
        presentation = html.includes('data-presentation="badge"')
          ? "badge"
          : "panel";
      },
      querySelector: (selector: string) =>
        selector === ".shell" ? { dataset: { presentation } } : null,
    };

    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    try {
      renderIntoRoot?.(root as never, createModel({ presentation: "panel" }), {
        reportContentHeight,
      });
      renderIntoRoot?.(root as never, createModel({ presentation: "badge" }), {
        reportContentHeight,
      });

      expect(animationFrames).toHaveLength(1);
      animationFrames[0]?.();
      expect(reportContentHeight).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the root scroll height when the shell is unavailable", async () => {
    const renderer = (await loadRendererModule()) as Partial<RendererModule> & {
      measureContentHeight?: (root: HTMLElement) => number;
    };
    const root = {
      scrollHeight: 240,
      querySelector: () => null,
    };

    expect(renderer.measureContentHeight?.(root as never)).toBe(240);
  });

  it("shrinks from a wrapped multi-session layout to one session", async () => {
    const renderer = (await loadRendererModule()) as Partial<RendererModule> & {
      measureContentHeight?: (root: HTMLElement) => number;
    };
    const expanded = createContentHeightFixture({
      shellHeight: 360,
      headerHeight: 84,
      content: "sessions",
      childRects: [
        { top: 108, bottom: 180 },
        { top: 436, bottom: 508 },
      ],
      listScrollHeight: 300,
      listClientHeight: 140,
    });
    const compact = createContentHeightFixture({
      shellHeight: 520,
      headerHeight: 44,
      content: "sessions",
      childRects: [{ top: 68, bottom: 140 }],
      listScrollHeight: 240,
      listClientHeight: 240,
    });

    vi.stubGlobal("getComputedStyle", () => ({
      paddingTop: "12px",
      paddingBottom: "12px",
      rowGap: "12px",
    }));
    try {
      expect([
        renderer.measureContentHeight?.(expanded.root),
        renderer.measureContentHeight?.(compact.root),
      ]).toEqual([520, 152]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("measures an empty state from its natural child span", async () => {
    const renderer = (await loadRendererModule()) as Partial<RendererModule> & {
      measureContentHeight?: (root: HTMLElement) => number;
    };
    const empty = createContentHeightFixture({
      shellHeight: 520,
      headerHeight: 44,
      content: "empty",
      childRects: [{ top: 68, bottom: 88 }],
    });

    vi.stubGlobal("getComputedStyle", () => ({
      paddingTop: "12px",
      paddingBottom: "12px",
      rowGap: "12px",
    }));
    try {
      expect(renderer.measureContentHeight?.(empty.root)).toBe(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("companion renderer css", () => {
  it("uses a transparent vibrancy canvas with a dark shell fallback", () => {
    const css = readStyles();
    const shellRule = css.match(/\.shell\s*{(?<body>[^}]*)}/)?.groups?.body;

    expect(css).toMatch(/html,\s*body\s*{[^}]*background:\s*transparent;/);
    expect(shellRule).toContain("background-color: rgba(17, 24, 39, 0.72);");
    expect(shellRule).toContain("border-radius: 14px;");
    expect(shellRule).toContain("backdrop-filter: blur(20px) saturate(140%);");
    expect(shellRule).toMatch(/opacity\s+180ms/);
    expect(shellRule).toMatch(/transform\s+180ms/);
  });

  it("keeps the panel header as the frameless-window drag region", () => {
    const css = readStyles();
    const headerRule = css.match(/\.header\s*{(?<body>[^}]*)}/)?.groups?.body;

    expect(headerRule).toContain("-webkit-app-region: drag;");
    expect(css).toMatch(/\.no-drag\s*{[^}]*-webkit-app-region:\s*no-drag;/);
  });

  it("styles all badge tones and breathes only a running badge", () => {
    const css = readStyles();

    for (const tone of ["green", "blue", "red", "yellow"]) {
      expect(css).toContain(`.badge[data-tone="${tone}"]`);
    }
    expect(css).toMatch(
      /\.badge\[data-status="running"\]\s+\.badge-ring\s*{[^}]*animation:\s*breathe/,
    );
    expect(css).toContain("@keyframes breathe");
    expect(css).toContain("font-variant-numeric: tabular-nums;");
  });

  it("provides short badge transitions and reduced-motion fallbacks", () => {
    const css = readStyles();
    const badgeRule = css.match(/\.badge\s*{(?<body>[^}]*)}/)?.groups?.body;
    const reducedMotion = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );

    expect(badgeRule).toMatch(/opacity\s+180ms/);
    expect(badgeRule).toMatch(/transform\s+180ms/);
    expect(css).toContain("@keyframes companion-shell-enter");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(reducedMotion).toMatch(
      /\.status-dot\[data-status="running"\],\s*\.badge\[data-status="running"\] \.badge-ring,\s*\.copy-action\[data-copied="true"\]\s*{[^}]*animation:\s*none;/,
    );
  });

  it("keeps every split summary item visible by wrapping the header", async () => {
    const { renderFloatingHtml } = await loadRendererModule();
    const summaryItems = [
      { status: "error", statusTone: "red", count: 1, label: "错误" },
      { status: "error", statusTone: "red", count: 1, label: "委托出错" },
      { status: "waiting", statusTone: "yellow", count: 1, label: "等待" },
      {
        status: "waiting",
        statusTone: "yellow",
        count: 1,
        label: "委托待确认",
      },
      { status: "running", statusTone: "green", count: 1, label: "运行中" },
      { status: "running", statusTone: "green", count: 1, label: "委托中" },
      { status: "done", statusTone: "blue", count: 1, label: "完成" },
      { status: "done", statusTone: "blue", count: 1, label: "委托完成" },
    ] as const;
    const html = renderFloatingHtml?.(
      createModel({ summaryItems: [...summaryItems] }),
    );
    const layout = resolvedClassDeclarations(readStyles(), [
      "status-text",
      "status-summary",
    ]);
    const renderedLabels = Array.from(
      html?.matchAll(/class="summary-label">([^<]+)<\/span>/g) ?? [],
      (match) => match[1]?.trim(),
    );

    expect(html?.match(/class="status-summary-item"/g)).toHaveLength(8);
    expect(renderedLabels).toEqual(summaryItems.map((item) => item.label));
    expect(layout).toMatchObject({
      "flex-wrap": "wrap",
      overflow: "visible",
      "white-space": "normal",
    });
  });

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
