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
    expect(html).toContain('data-action="hide"');
    expect(html).toContain('data-action="minimize"');
    expect(html).toContain("修复 companion");
    expect(html).toContain("复制路径");
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

    expect(requestWindowAction.mock.calls).toEqual([["hover-enter"], ["hover-enter"]]);
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
});
