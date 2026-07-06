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

function createModel(overrides: Partial<FloatingViewModel>): FloatingViewModel {
  return {
    status: "running",
    count: 1,
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
    expect(html).toContain('aria-label="最小化"');
    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain('class="status-dot"');
    expect(html).toContain('class="session-path-row"');
    expect(html).toContain('title="/tmp/project"');
    expect(html).toContain("修复 companion");
    expect(html).toContain("复制路径");
    expect(html).toContain("等待用户确认");
    expect(html).toContain("02:14");
  });

  it("renders compact icon-only window actions", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({}));

    expect(html).toContain('aria-hidden="true">📌</span>');
    expect(html).toContain('aria-hidden="true">−</span>');
    expect(html).toContain('aria-hidden="true">×</span>');
    expect(html).not.toContain('data-action="pin">置顶</button>');
    expect(html).not.toContain('data-action="minimize">最小化</button>');
    expect(html).not.toContain('data-action="close">关闭</button>');
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

  it("uses a narrow drag handle instead of making the whole header draggable", async () => {
    const { renderFloatingHtml } = await loadRendererModule();

    const html = renderFloatingHtml?.(createModel({}));

    expect(html).toContain('<header class="header">');
    expect(html).not.toContain('<header class="header drag-region">');
    expect(html).toContain('class="drag-handle drag-region"');
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
