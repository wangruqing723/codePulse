import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from "electron";
import { buildStateFromConfig } from "../lib/state";
import type { Preferences } from "../lib/types";
import { resolveDefaultWslContext, type WslContext } from "../lib/wsl";
import {
  badgeBounds,
  clampCompanionHeight,
  dockWindow,
  hiddenBounds,
  pointWithinRect,
  resizeToHeight,
  revealedBounds,
  type DockEdge,
  type Rect,
} from "./geometry";
import { resolveCompanionStateSource } from "./state-source";
import {
  buildFloatingViewModel,
  type CompanionPlatform,
  type CompanionPresentation,
  type FloatingViewModel,
} from "./view-model";
import {
  killCompanionProcess,
  registerCompanionProcess,
} from "./process-control";
import {
  companionPreferencesRoot,
  loadCompanionEventRoot,
  resolveCompanionPreferences,
} from "../lib/companion-preferences";

const REFRESH_INTERVAL_MS = 5_000;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 360;
const WINDOW_MIN_HEIGHT = 120;
const WINDOW_MAX_HEIGHT = 520;
const BADGE_SIZE = { width: 120, height: 44 } as const;
const VISIBLE_SLIVER_PX = 28;
const EDGE_THRESHOLD_PX = 48;
const MOVE_SETTLE_MS = 180;
const PROGRAMMATIC_MOVE_SUPPRESS_MS = 220;
const HOVER_LEAVE_HIDE_DELAY_MS = MOVE_SETTLE_MS + 80;
const WINDOW_STATE_FILE = "window-state.json";
const DEFAULT_PREFERENCES: Preferences = {
  activeWindowMinutes: process.env.CODEPULSE_ACTIVE_WINDOW_MINUTES ?? "5",
  monitorProjects: process.env.CODEPULSE_MONITOR_PROJECTS,
};

interface PersistedWindowState {
  bounds: Rect;
  fullBounds: Rect;
  dockedEdge?: DockEdge;
  hidden: boolean;
}

interface RuntimeWindowState {
  fullBounds: Rect;
  dockedEdge?: DockEdge;
  hidden: boolean;
}

interface InitialWindowState {
  initialBounds: Rect;
  runtimeState: RuntimeWindowState;
}

type WindowAction =
  "pin" | "minimize" | "close" | "hover-enter" | "hover-leave";
type ReadyToShowWindow = Pick<BrowserWindow, "loadFile" | "once" | "show">;
type LifecycleWindow = Pick<BrowserWindow, "on">;

let mainWindow: BrowserWindow | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let moveTimer: NodeJS.Timeout | undefined;
let hideTimer: NodeJS.Timeout | undefined;
let suppressMoveEventsUntil = 0;
let currentModel: FloatingViewModel = buildFloatingViewModel(undefined, {
  platform: platformForHost(),
});
let refreshInFlight: Promise<void> | undefined;
let runtimeWindowState: RuntimeWindowState | undefined;
let cachedWslContext: WslContext | undefined;
let resolvingWslContext: Promise<WslContext> | undefined;

function clearMoveTimer(): void {
  clearTimeout(moveTimer);
  moveTimer = undefined;
}

function clearHideTimer(): void {
  clearTimeout(hideTimer);
  hideTimer = undefined;
}

function platformForHost(): CompanionPlatform {
  return process.platform === "win32" ? "win32" : "darwin";
}

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  | "backgroundColor"
  | "maxHeight"
  | "maxWidth"
  | "minHeight"
  | "minWidth"
  | "transparent"
  | "vibrancy"
>;

function windowChromeOptionsForPlatform(
  platform: NodeJS.Platform,
): WindowChromeOptions {
  if (platform === "darwin") {
    return {
      minWidth: BADGE_SIZE.width,
      maxWidth: WINDOW_WIDTH,
      minHeight: BADGE_SIZE.height,
      maxHeight: WINDOW_MAX_HEIGHT,
      backgroundColor: "#00000000",
      transparent: true,
      vibrancy: "hud",
    };
  }

  return {
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    maxHeight: WINDOW_MAX_HEIGHT,
    backgroundColor: "#111827",
  };
}

function currentPresentation(): CompanionPresentation {
  return process.platform === "darwin" && runtimeWindowState?.hidden
    ? "badge"
    : "panel";
}

function currentPinState(): boolean {
  return mainWindow?.isAlwaysOnTop() ?? true;
}

function stateRoot(): string {
  return path.join(app.getPath("userData"), "state");
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function toRect(bounds: Rectangle): Rect {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function toRectangle(bounds: Rect): Rectangle {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

function currentWorkArea(bounds: Rect): Rect {
  return toRect(screen.getDisplayMatching(toRectangle(bounds)).workArea);
}

function defaultBounds(): Rect {
  const workArea = toRect(screen.getPrimaryDisplay().workArea);
  return {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: workArea.x + workArea.width - WINDOW_WIDTH - 24,
    y:
      workArea.y +
      Math.max(24, Math.round((workArea.height - WINDOW_HEIGHT) / 2)),
  };
}

function resolveInitialWindowState(
  persisted: PersistedWindowState | undefined,
  fallbackBounds: Rect,
): InitialWindowState {
  const fullBounds =
    persisted?.fullBounds ?? persisted?.bounds ?? fallbackBounds;
  const shouldRevealPersistedHiddenState =
    !!persisted?.hidden && !!persisted.dockedEdge;

  return {
    initialBounds: shouldRevealPersistedHiddenState
      ? fullBounds
      : (persisted?.bounds ?? fallbackBounds),
    runtimeState: {
      fullBounds,
      dockedEdge: persisted?.dockedEdge,
      hidden: shouldRevealPersistedHiddenState
        ? false
        : (persisted?.hidden ?? false),
    },
  };
}

async function loadWindowState(): Promise<PersistedWindowState | undefined> {
  try {
    return JSON.parse(
      await readFile(windowStatePath(), "utf8"),
    ) as PersistedWindowState;
  } catch {
    return undefined;
  }
}

async function saveWindowState(): Promise<void> {
  if (!mainWindow || !runtimeWindowState) {
    return;
  }

  const payload: PersistedWindowState = {
    bounds: toRect(mainWindow.getBounds()),
    fullBounds: runtimeWindowState.fullBounds,
    dockedEdge: runtimeWindowState.dockedEdge,
    hidden: runtimeWindowState.hidden,
  };

  await writeFile(
    windowStatePath(),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function nearestEdge(bounds: Rect, workArea: Rect): DockEdge | undefined {
  const distances: Array<[DockEdge, number]> = [
    ["left", Math.abs(bounds.x - workArea.x)],
    [
      "right",
      Math.abs(workArea.x + workArea.width - (bounds.x + bounds.width)),
    ],
    ["top", Math.abs(bounds.y - workArea.y)],
    [
      "bottom",
      Math.abs(workArea.y + workArea.height - (bounds.y + bounds.height)),
    ],
  ];

  const [edge, distance] = distances.sort((a, b) => a[1] - b[1])[0];
  return distance <= EDGE_THRESHOLD_PX ? edge : undefined;
}

function applyWindowBounds(bounds: Rect): void {
  if (!mainWindow) {
    return;
  }

  suppressMoveEventsUntil = Date.now() + PROGRAMMATIC_MOVE_SUPPRESS_MS;
  mainWindow.setBounds(toRectangle(bounds));
}

async function persistWindowStateSoon(): Promise<void> {
  try {
    await saveWindowState();
  } catch {
    // Ignore persistence failures to keep the floating window responsive.
  }
}

function dockToEdge(edge: DockEdge, hidden: boolean): void {
  if (!mainWindow || !runtimeWindowState) {
    return;
  }

  const currentBounds = toRect(mainWindow.getBounds());
  const workArea = currentWorkArea(currentBounds);
  const fullBounds = dockWindow(
    runtimeWindowState.hidden ? runtimeWindowState.fullBounds : currentBounds,
    workArea,
    edge,
  );
  const nextBounds = hidden
    ? process.platform === "darwin"
      ? badgeBounds(fullBounds, workArea, edge, BADGE_SIZE)
      : hiddenBounds(fullBounds, workArea, edge, VISIBLE_SLIVER_PX)
    : fullBounds;

  runtimeWindowState = {
    fullBounds,
    dockedEdge: edge,
    hidden,
  };
  applyWindowBounds(nextBounds);
  publishModel(currentModel);
  void persistWindowStateSoon();
}

// renderer 测量到内容真实高度后调用：把窗口高度收敛到内容大小（夹在
// [min,max] 区间），消除卡片下方的固定留白。macOS 徽章态尺寸固定，忽略
// 收起前可能仍在队列中的测高消息；Windows sliver 仍沿用原有隐藏态逻辑。
function applyContentHeight(contentHeight: number): void {
  if (!mainWindow || !runtimeWindowState) {
    return;
  }

  if (currentPresentation() === "badge") {
    return;
  }

  const height = clampCompanionHeight(contentHeight, {
    min: WINDOW_MIN_HEIGHT,
    max: WINDOW_MAX_HEIGHT,
  });
  if (height === Math.round(runtimeWindowState.fullBounds.height)) {
    return;
  }

  const workArea = currentWorkArea(runtimeWindowState.fullBounds);
  const fullBounds = resizeToHeight(
    runtimeWindowState.fullBounds,
    workArea,
    runtimeWindowState.dockedEdge,
    height,
  );

  runtimeWindowState = {
    ...runtimeWindowState,
    fullBounds,
  };

  if (!runtimeWindowState.hidden) {
    applyWindowBounds(fullBounds);
  }
  void persistWindowStateSoon();
}

function revealDockedWindow(): void {
  clearHideTimer();
  if (
    !mainWindow ||
    !runtimeWindowState?.dockedEdge ||
    !runtimeWindowState.hidden
  ) {
    return;
  }

  const currentBounds = toRect(mainWindow.getBounds());
  const workArea = currentWorkArea(currentBounds);
  const revealed = revealedBounds(
    currentBounds,
    runtimeWindowState.fullBounds,
    workArea,
  );

  runtimeWindowState = {
    ...runtimeWindowState,
    fullBounds: revealed,
    hidden: false,
  };
  applyWindowBounds(revealed);
  publishModel(currentModel);
  void persistWindowStateSoon();
}

function hideDockedWindow(): void {
  clearHideTimer();
  if (!runtimeWindowState?.dockedEdge) {
    dockToEdge("right", true);
    return;
  }

  dockToEdge(runtimeWindowState.dockedEdge, true);
}

function prepareForWindowMinimize(): void {
  clearHideTimer();
  clearMoveTimer();
}

function restoreDockedWindow(): void {
  clearHideTimer();
  clearMoveTimer();
  if (!mainWindow || !runtimeWindowState?.dockedEdge) {
    return;
  }

  const workArea = currentWorkArea(runtimeWindowState.fullBounds);
  const fullBounds = dockWindow(
    runtimeWindowState.fullBounds,
    workArea,
    runtimeWindowState.dockedEdge,
  );

  runtimeWindowState = {
    ...runtimeWindowState,
    fullBounds,
    hidden: false,
  };
  applyWindowBounds(fullBounds);
  publishModel(currentModel);
  void persistWindowStateSoon();
}

function publishModel(model: FloatingViewModel): void {
  const publishedModel: FloatingViewModel = {
    ...model,
    presentation: currentPresentation(),
  };
  currentModel = publishedModel;
  mainWindow?.webContents.send("companion:view-model", publishedModel);
}

async function resolveCachedWsl(): Promise<WslContext> {
  if (cachedWslContext) {
    return cachedWslContext;
  }

  if (!resolvingWslContext) {
    resolvingWslContext = resolveDefaultWslContext()
      .then((result) => {
        cachedWslContext = result;
        return result;
      })
      .finally(() => {
        resolvingWslContext = undefined;
      });
  }

  return resolvingWslContext;
}

async function refreshModel(): Promise<void> {
  const platform = platformForHost();
  const preferencesRoot = companionPreferencesRoot();
  const preferences = await resolveCompanionPreferences(
    preferencesRoot,
    DEFAULT_PREFERENCES,
  );
  // macOS 下 hook 事件由 Raycast 写入其扩展目录，悬浮窗默认读不到；从共享快照
  // 取回 Raycast 的 eventRoot，让被动扫描与 hook 事件在悬浮窗侧也能合并。
  const eventRoot =
    platform === "darwin"
      ? await loadCompanionEventRoot(preferencesRoot)
      : undefined;
  const source = await resolveCompanionStateSource(platform, {
    stateRoot: stateRoot(),
    preferences,
    eventRoot,
    resolveDefaultWslContext: resolveCachedWsl,
  });

  if (source.kind === "unavailable") {
    publishModel(
      buildFloatingViewModel(undefined, {
        ...source.viewModelContext,
        isPinned: currentPinState(),
      }),
    );
    return;
  }

  try {
    const { snapshot } = await buildStateFromConfig(source.stateConfig);
    publishModel(
      buildFloatingViewModel(snapshot, {
        ...source.viewModelContext,
        isPinned: currentPinState(),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackContext =
      platform === "win32"
        ? {
            ...source.viewModelContext,
            unavailableReason: message,
          }
        : source.viewModelContext;
    publishModel(
      buildFloatingViewModel(undefined, {
        ...fallbackContext,
        isPinned: currentPinState(),
      }),
    );
  }
}

async function refreshModelOnce(): Promise<void> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = refreshModel().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

function scheduleMoveEvaluation(): void {
  if (!mainWindow || !runtimeWindowState) {
    return;
  }

  clearHideTimer();

  if (Date.now() < suppressMoveEventsUntil) {
    return;
  }

  clearMoveTimer();
  moveTimer = setTimeout(() => {
    if (!mainWindow) {
      return;
    }

    const bounds = toRect(mainWindow.getBounds());
    const workArea = currentWorkArea(bounds);
    const edge = nearestEdge(bounds, workArea);
    if (!edge) {
      runtimeWindowState = {
        fullBounds: bounds,
        hidden: false,
      };
      void persistWindowStateSoon();
      return;
    }

    dockToEdge(edge, false);
  }, MOVE_SETTLE_MS);
}

// 指针是否仍落在窗口内。展开瞬间窗口尺寸/位置突变会让 Chromium 在 macOS 抖出
// 假的 mouseleave，仅凭 DOM 事件会误收起；这里用真实屏幕坐标做权威判断。
function cursorWithinWindow(): boolean {
  if (!mainWindow) {
    return false;
  }

  try {
    return pointWithinRect(
      screen.getCursorScreenPoint(),
      toRect(mainWindow.getBounds()),
    );
  } catch {
    // 取指针坐标失败时不阻止隐藏，回退到原有行为。
    return false;
  }
}

function scheduleDockedHide(): void {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = undefined;
    if (!runtimeWindowState?.dockedEdge) {
      return;
    }

    // 指针其实还在展开面板内（假 mouseleave 或悬停未离开）——不隐藏，另排一次
    // 复查，直到指针真正移出窗口才收起。
    if (cursorWithinWindow()) {
      scheduleDockedHide();
      return;
    }

    hideDockedWindow();
  }, HOVER_LEAVE_HIDE_DELAY_MS);
}

function handleWindowAction(action: WindowAction): void {
  switch (action) {
    case "pin": {
      const pinned = mainWindow?.isAlwaysOnTop() ?? false;
      const nextPinned = !pinned;
      mainWindow?.setAlwaysOnTop(nextPinned);
      publishModel({
        ...currentModel,
        isPinned: nextPinned,
      });
      break;
    }
    case "hover-enter":
      revealDockedWindow();
      break;
    case "hover-leave":
      if (runtimeWindowState?.dockedEdge) {
        scheduleDockedHide();
      }
      break;
    case "minimize":
      prepareForWindowMinimize();
      mainWindow?.minimize();
      break;
    case "close":
      mainWindow?.close();
      break;
  }
}

function attachWindowLifecycleHandlers(window: LifecycleWindow): void {
  window.on("move", scheduleMoveEvaluation);
  window.on("minimize", prepareForWindowMinimize);
  window.on("restore", restoreDockedWindow);
  window.on("closed", () => {
    mainWindow = undefined;
    clearMoveTimer();
    clearHideTimer();
  });
}

export async function loadWindowContentAndShow(
  window: ReadyToShowWindow,
  filePath: string,
  afterShow?: () => void,
): Promise<void> {
  window.once("ready-to-show", () => {
    window.show();
    afterShow?.();
  });
  await window.loadFile(filePath);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const persisted = await loadWindowState();
  const { initialBounds, runtimeState } = resolveInitialWindowState(
    persisted,
    defaultBounds(),
  );
  runtimeWindowState = runtimeState;

  const iconPath = path.join(__dirname, "assets", "codepulse-icon-v2.png");
  const window = new BrowserWindow({
    ...toRectangle(initialBounds),
    ...windowChromeOptionsForPlatform(process.platform),
    alwaysOnTop: true,
    autoHideMenuBar: true,
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    icon: iconPath,
    maximizable: false,
    minimizable: true,
    resizable: false,
    show: false,
    title: "CodePulse Companion",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await loadWindowContentAndShow(
    window,
    path.join(__dirname, "index.html"),
    () => {
      if (runtimeWindowState?.dockedEdge && runtimeWindowState.hidden) {
        hideDockedWindow();
      }
    },
  );
  attachWindowLifecycleHandlers(window);

  return window;
}

export const __testing__ = {
  applyContentHeight,
  attachWindowLifecycleHandlers,
  getRuntimeWindowState: (): RuntimeWindowState | undefined =>
    runtimeWindowState,
  handleWindowAction,
  registerIpcHandlers,
  refreshModelOnce,
  resolveInitialWindowState,
  windowChromeOptionsForPlatform,
  resetState: (): void => {
    mainWindow = undefined;
    refreshTimer = undefined;
    clearMoveTimer();
    clearHideTimer();
    suppressMoveEventsUntil = 0;
    runtimeWindowState = undefined;
    refreshInFlight = undefined;
    cachedWslContext = undefined;
    resolvingWslContext = undefined;
  },
  setMainWindow: (window: BrowserWindow | undefined): void => {
    mainWindow = window;
  },
  setRuntimeWindowState: (state: RuntimeWindowState | undefined): void => {
    runtimeWindowState = state;
  },
};

function registerIpcHandlers(): void {
  ipcMain.handle("companion:get-state", () => currentModel);
  ipcMain.handle("companion:copy-text", (_event, value: string) => {
    clipboard.writeText(value);
  });
  ipcMain.on("companion:window-action", (_event, action: WindowAction) => {
    handleWindowAction(action);
  });
  ipcMain.on("companion:force-exit", () => {
    void killCompanionProcess();
  });
  ipcMain.on("companion:dock-request", (_event, edge: DockEdge) => {
    dockToEdge(edge, false);
  });
  ipcMain.on("companion:content-height", (_event, height: number) => {
    applyContentHeight(height);
  });
}

function startRefreshTimer(): void {
  refreshTimer = setInterval(() => {
    void refreshModelOnce();
  }, REFRESH_INTERVAL_MS);
}

interface StartupHooks {
  registerProcess: () => Promise<void>;
  registerIpcHandlers: () => void;
  createMainWindow: () => Promise<BrowserWindow | void>;
  refreshModelOnce: () => Promise<void>;
  startRefreshTimer: () => void;
}

export async function initializeCompanionStartup({
  registerProcess,
  registerIpcHandlers,
  createMainWindow,
  refreshModelOnce,
  startRefreshTimer,
}: StartupHooks): Promise<void> {
  await registerProcess();
  registerIpcHandlers();
  await createMainWindow();
  await refreshModelOnce();
  startRefreshTimer();
}

async function start(): Promise<void> {
  app.setName("CodePulse Companion");
  await initializeCompanionStartup({
    registerProcess: async () => {
      await registerCompanionProcess({
        pid: process.pid,
        launcherPid: process.ppid,
        startedAt: new Date().toISOString(),
        platform: process.platform,
        mode: app.isPackaged ? "packaged" : "dev",
        execPath: process.execPath,
        argv: process.argv.slice(1),
      });
    },
    registerIpcHandlers,
    createMainWindow: async () => {
      mainWindow = await createMainWindow();
      return mainWindow;
    },
    refreshModelOnce,
    startRefreshTimer,
  });
}

app.whenReady().then(() => {
  void start();
});

app.on("window-all-closed", () => {
  clearInterval(refreshTimer);
  clearHideTimer();
  app.quit();
});

app.on("before-quit", () => {
  clearInterval(refreshTimer);
  clearHideTimer();
});
