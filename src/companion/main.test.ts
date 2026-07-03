import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => "/tmp/codepulse"),
    on: vi.fn(),
    quit: vi.fn(),
    setName: vi.fn(),
    whenReady: vi.fn(() => new Promise<void>(() => {})),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    })),
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    })),
  },
}));

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  app: electronMocks.app,
  clipboard: electronMocks.clipboard,
  ipcMain: electronMocks.ipcMain,
  screen: electronMocks.screen,
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../lib/state", () => ({
  buildStateFromConfig: vi.fn(),
}));

vi.mock("../lib/wsl", () => ({
  resolveDefaultWslContext: vi.fn(),
}));

vi.mock("./state-source", () => ({
  resolveCompanionStateSource: vi.fn(),
}));

vi.mock("./view-model", () => ({
  buildFloatingViewModel: vi.fn(() => ({
    count: 0,
    sessions: [],
    status: "empty",
    text: "暂无活跃会话",
  })),
}));

describe("companion main window display flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers ready-to-show before awaiting loadFile so an early event still shows the window", async () => {
    const mainModule = await import("./main");
    const order: string[] = [];
    let readyToShowListener: (() => void) | undefined;

    const fakeWindow = {
      loadFile: vi.fn(async (filePath: string) => {
        order.push(`loadFile:${filePath}`);
        readyToShowListener?.();
      }),
      once: vi.fn((event: string, listener: () => void) => {
        order.push(`once:${event}`);
        readyToShowListener = listener;
        return fakeWindow;
      }),
      show: vi.fn(() => {
        order.push("show");
      }),
    };

    expect(typeof mainModule.loadWindowContentAndShow).toBe("function");

    await mainModule.loadWindowContentAndShow?.(
      fakeWindow as never,
      "/tmp/index.html",
      () => {
        order.push("after-show");
      },
    );

    expect(order).toEqual([
      "once:ready-to-show",
      "loadFile:/tmp/index.html",
      "show",
      "after-show",
    ]);
  });

  it("keeps the ready-to-show listener active after loadFile resolves", async () => {
    const mainModule = await import("./main");
    const order: string[] = [];
    let readyToShowListener: (() => void) | undefined;

    const fakeWindow = {
      loadFile: vi.fn(async () => {
        order.push("loadFile");
      }),
      once: vi.fn((event: string, listener: () => void) => {
        order.push(`once:${event}`);
        readyToShowListener = listener;
        return fakeWindow;
      }),
      show: vi.fn(() => {
        order.push("show");
      }),
    };

    await mainModule.loadWindowContentAndShow?.(
      fakeWindow as never,
      "/tmp/index.html",
      () => {
        order.push("after-show");
      },
    );

    expect(order).toEqual(["once:ready-to-show", "loadFile"]);

    readyToShowListener?.();

    expect(order).toEqual([
      "once:ready-to-show",
      "loadFile",
      "show",
      "after-show",
    ]);
  });
});
