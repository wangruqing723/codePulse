import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type Rectangle,
} from "electron";
import { buildStateFromConfig } from "../lib/state";
import type { Preferences } from "../lib/types";
import { resolveDefaultWslContext, type WslContext } from "../lib/wsl";
import {
  dockWindow,
  hiddenBounds,
  revealedBounds,
  type DockEdge,
  type Rect,
} from "./geometry";
import { resolveCompanionStateSource } from "./state-source";
import {
  buildFloatingViewModel,
  type CompanionPlatform,
  type FloatingViewModel,
} from "./view-model";

const REFRESH_INTERVAL_MS = 5_000;
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 360;
const VISIBLE_SLIVER_PX = 28;
const EDGE_THRESHOLD_PX = 48;
const MOVE_SETTLE_MS = 180;
const PROGRAMMATIC_MOVE_SUPPRESS_MS = 220;
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

type WindowAction = "hide" | "hover-enter" | "hover-leave" | "minimize";
type ReadyToShowWindow = Pick<BrowserWindow, "loadFile" | "once" | "show">;

let mainWindow: BrowserWindow | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let moveTimer: NodeJS.Timeout | undefined;
let suppressMoveEventsUntil = 0;
let currentModel: FloatingViewModel = buildFloatingViewModel(undefined, {
  platform: platformForHost(),
});
let refreshInFlight: Promise<void> | undefined;
let runtimeWindowState: RuntimeWindowState | undefined;
let cachedWslContext: WslContext | undefined;
let resolvingWslContext: Promise<WslContext> | undefined;

function platformForHost(): CompanionPlatform {
  return process.platform === "win32" ? "win32" : "darwin";
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
    y: workArea.y + Math.max(24, Math.round((workArea.height - WINDOW_HEIGHT) / 2)),
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

  await writeFile(windowStatePath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function nearestEdge(bounds: Rect, workArea: Rect): DockEdge | undefined {
  const distances: Array<[DockEdge, number]> = [
    ["left", Math.abs(bounds.x - workArea.x)],
    ["right", Math.abs(workArea.x + workArea.width - (bounds.x + bounds.width))],
    ["top", Math.abs(bounds.y - workArea.y)],
    ["bottom", Math.abs(workArea.y + workArea.height - (bounds.y + bounds.height))],
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
    ? hiddenBounds(fullBounds, workArea, edge, VISIBLE_SLIVER_PX)
    : fullBounds;

  runtimeWindowState = {
    fullBounds,
    dockedEdge: edge,
    hidden,
  };
  applyWindowBounds(nextBounds);
  void persistWindowStateSoon();
}

function revealDockedWindow(): void {
  if (!mainWindow || !runtimeWindowState?.dockedEdge || !runtimeWindowState.hidden) {
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
  void persistWindowStateSoon();
}

function hideDockedWindow(): void {
  if (!runtimeWindowState?.dockedEdge) {
    dockToEdge("right", true);
    return;
  }

  dockToEdge(runtimeWindowState.dockedEdge, true);
}

function publishModel(model: FloatingViewModel): void {
  currentModel = model;
  mainWindow?.webContents.send("companion:view-model", model);
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
  const source = await resolveCompanionStateSource(platform, {
    stateRoot: stateRoot(),
    preferences: DEFAULT_PREFERENCES,
    resolveDefaultWslContext: resolveCachedWsl,
  });

  if (source.kind === "unavailable") {
    publishModel(buildFloatingViewModel(undefined, source.viewModelContext));
    return;
  }

  try {
    const { snapshot } = await buildStateFromConfig(source.stateConfig);
    publishModel(buildFloatingViewModel(snapshot, source.viewModelContext));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackContext =
      platform === "win32"
        ? {
            ...source.viewModelContext,
            unavailableReason: message,
          }
        : source.viewModelContext;
    publishModel(buildFloatingViewModel(undefined, fallbackContext));
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

  if (Date.now() < suppressMoveEventsUntil) {
    return;
  }

  clearTimeout(moveTimer);
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

function handleWindowAction(action: WindowAction): void {
  switch (action) {
    case "hide":
      hideDockedWindow();
      break;
    case "hover-enter":
      revealDockedWindow();
      break;
    case "hover-leave":
      if (runtimeWindowState?.dockedEdge) {
        hideDockedWindow();
      }
      break;
    case "minimize":
      mainWindow?.minimize();
      break;
  }
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
  const initialBounds = persisted?.bounds ?? defaultBounds();
  runtimeWindowState = {
    fullBounds: persisted?.fullBounds ?? initialBounds,
    dockedEdge: persisted?.dockedEdge,
    hidden: persisted?.hidden ?? false,
  };

  const iconPath = path.join(__dirname, "assets", "codepulse-icon-v2.png");
  const window = new BrowserWindow({
    ...toRectangle(initialBounds),
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: 240,
    maxHeight: 520,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#111827",
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
  await loadWindowContentAndShow(window, path.join(__dirname, "index.html"), () => {
    if (runtimeWindowState?.dockedEdge && runtimeWindowState.hidden) {
      hideDockedWindow();
    }
  });
  window.on("move", scheduleMoveEvaluation);
  window.on("closed", () => {
    mainWindow = undefined;
    clearTimeout(moveTimer);
  });

  return window;
}

function registerIpcHandlers(): void {
  ipcMain.handle("companion:get-state", () => currentModel);
  ipcMain.handle("companion:copy-text", (_event, value: string) => {
    clipboard.writeText(value);
  });
  ipcMain.on("companion:window-action", (_event, action: WindowAction) => {
    handleWindowAction(action);
  });
  ipcMain.on("companion:dock-request", (_event, edge: DockEdge) => {
    dockToEdge(edge, false);
  });
}

async function start(): Promise<void> {
  app.setName("CodePulse Companion");
  mainWindow = await createMainWindow();
  registerIpcHandlers();

  await refreshModelOnce();
  refreshTimer = setInterval(() => {
    void refreshModelOnce();
  }, REFRESH_INTERVAL_MS);
}

app.whenReady().then(() => {
  void start();
});

app.on("window-all-closed", () => {
  clearInterval(refreshTimer);
  app.quit();
});

app.on("before-quit", () => {
  clearInterval(refreshTimer);
});
