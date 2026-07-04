import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => "/tmp/codepulse"),
    isPackaged: false,
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

const processControlMocks = vi.hoisted(() => ({
  killCompanionProcess: vi.fn(),
  registerCompanionProcess: vi.fn(),
}));

vi.mock("./process-control", () => ({
  killCompanionProcess: processControlMocks.killCompanionProcess,
  registerCompanionProcess: processControlMocks.registerCompanionProcess,
}));

describe("companion main window display flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processControlMocks.registerCompanionProcess.mockResolvedValue(undefined);
    processControlMocks.killCompanionProcess.mockResolvedValue({
      status: "not-found",
      matchedPids: [],
    });
  });

  it("registers ipc handlers before creating the window", async () => {
    const mainModule = await import("./main");
    const order: string[] = [];

    await mainModule.initializeCompanionStartup?.({
      registerProcess: async () => {
        order.push("register-process");
      },
      registerIpcHandlers: () => {
        order.push("register-ipc");
      },
      createMainWindow: async () => {
        order.push("create-window");
      },
      refreshModelOnce: async () => {
        order.push("refresh");
      },
      startRefreshTimer: () => {
        order.push("timer");
      },
    });

    expect(order).toEqual([
      "register-process",
      "register-ipc",
      "create-window",
      "refresh",
      "timer",
    ]);
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

  it("binds minimize and restore lifecycle handlers for docked window state recovery", async () => {
    const mainModule = await import("./main");
    const listeners = new Map<string, () => void>();

    const fakeWindow = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return fakeWindow;
      }),
    };

    mainModule.__testing__.attachWindowLifecycleHandlers(fakeWindow as never);

    expect(fakeWindow.on).toHaveBeenCalledWith("move", expect.any(Function));
    expect(fakeWindow.on).toHaveBeenCalledWith(
      "minimize",
      expect.any(Function),
    );
    expect(fakeWindow.on).toHaveBeenCalledWith("restore", expect.any(Function));
    expect(fakeWindow.on).toHaveBeenCalledWith("closed", expect.any(Function));
    expect(listeners.get("minimize")).toBeTypeOf("function");
    expect(listeners.get("restore")).toBeTypeOf("function");
  });

  it("starts from full bounds when persisted state was edge-hidden", async () => {
    const mainModule = await import("./main");

    expect(mainModule.__testing__.resolveInitialWindowState).toBeTypeOf(
      "function",
    );

    const resolved = mainModule.__testing__.resolveInitialWindowState?.(
      {
        bounds: {
          x: 1412,
          y: 200,
          width: 340,
          height: 360,
        },
        fullBounds: {
          x: 1100,
          y: 200,
          width: 340,
          height: 360,
        },
        dockedEdge: "right",
        hidden: true,
      },
      {
        x: 1076,
        y: 270,
        width: 340,
        height: 360,
      },
    );

    expect(resolved).toEqual({
      initialBounds: {
        x: 1100,
        y: 200,
        width: 340,
        height: 360,
      },
      runtimeState: {
        fullBounds: {
          x: 1100,
          y: 200,
          width: 340,
          height: 360,
        },
        dockedEdge: "right",
        hidden: false,
      },
    });
  });

  it("registers force-exit IPC without routing it through window action handling", async () => {
    const mainModule = await import("./main");

    mainModule.__testing__.registerIpcHandlers();

    const forceExitHandler = electronMocks.ipcMain.on.mock.calls.find(
      ([channel]) => channel === "companion:force-exit",
    )?.[1];

    expect(forceExitHandler).toBeTypeOf("function");

    await forceExitHandler?.();

    expect(processControlMocks.killCompanionProcess).toHaveBeenCalledTimes(1);
  });

  it("cancels pending dock hide when minimizing a revealed docked window", async () => {
    vi.useFakeTimers();
    const mainModule = await import("./main");
    const fakeWindow = {
      getBounds: vi.fn(() => ({
        x: 1100,
        y: 200,
        width: 340,
        height: 360,
      })),
      setBounds: vi.fn(),
      minimize: vi.fn(),
    };

    mainModule.__testing__.resetState();
    mainModule.__testing__.setMainWindow(fakeWindow as never);
    mainModule.__testing__.setRuntimeWindowState({
      fullBounds: {
        x: 1100,
        y: 200,
        width: 340,
        height: 360,
      },
      dockedEdge: "right",
      hidden: false,
    });

    mainModule.__testing__.handleWindowAction("hover-leave");
    mainModule.__testing__.handleWindowAction("minimize");
    vi.advanceTimersByTime(400);

    expect(fakeWindow.minimize).toHaveBeenCalledTimes(1);
    expect(fakeWindow.setBounds).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("reveals a restored docked window back to its interactive full bounds", async () => {
    const mainModule = await import("./main");
    const listeners = new Map<string, () => void>();
    const fakeWindow = {
      getBounds: vi.fn(() => ({
        x: 1412,
        y: 200,
        width: 340,
        height: 360,
      })),
      setBounds: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return fakeWindow;
      }),
    };

    mainModule.__testing__.resetState();
    mainModule.__testing__.setMainWindow(fakeWindow as never);
    mainModule.__testing__.setRuntimeWindowState({
      fullBounds: {
        x: 1100,
        y: 200,
        width: 340,
        height: 360,
      },
      dockedEdge: "right",
      hidden: true,
    });

    mainModule.__testing__.attachWindowLifecycleHandlers(fakeWindow as never);
    listeners.get("restore")?.();

    expect(fakeWindow.setBounds).toHaveBeenCalledWith({
      x: 1100,
      y: 200,
      width: 340,
      height: 360,
    });
    expect(mainModule.__testing__.getRuntimeWindowState()).toEqual({
      fullBounds: {
        x: 1100,
        y: 200,
        width: 340,
        height: 360,
      },
      dockedEdge: "right",
      hidden: false,
    });
  });
});
