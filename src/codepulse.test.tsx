import { describe, expect, it, vi } from "vitest";
import type { Preferences, SessionRecord, StateSnapshot } from "./lib/types";

const testState = vi.hoisted(() => ({
  snapshot: undefined as StateSnapshot | undefined,
  menuBarStyle: "count" as Preferences["menuBarStyle"],
  useStateCall: 0,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
    useState: <T,>(initial: T) => {
      const call = testState.useStateCall++;
      if (call === 0) {
        return [testState.snapshot, vi.fn()];
      }
      if (call === 1) {
        return [undefined, vi.fn()];
      }
      return [initial, vi.fn()];
    },
  };
});

vi.mock("@raycast/api", () => {
  const MenuBarExtra = Object.assign(() => undefined, {
    Item: () => undefined,
    Section: () => undefined,
    Submenu: () => undefined,
  });

  return {
    Alert: { ActionStyle: { Destructive: "destructive" } },
    Clipboard: { copy: vi.fn() },
    Icon: new Proxy({}, { get: (_target, property) => String(property) }),
    MenuBarExtra,
    Toast: { Style: { Failure: "failure", Success: "success" } },
    confirmAlert: vi.fn(),
    environment: { supportPath: "/tmp/codepulse-support" },
    getPreferenceValues: () => ({ menuBarStyle: testState.menuBarStyle }),
    open: vi.fn(),
  };
});

vi.mock("./lib/hooks", () => ({
  CodexNotifyConflictError: class CodexNotifyConflictError extends Error {
    existingNotify = "";
  },
  getHookInstallStatus: vi.fn(),
  installHooks: vi.fn(),
  uninstallHooks: vi.fn(),
}));
vi.mock("./lib/terminal", () => ({ focusTerminalSession: vi.fn() }));
vi.mock("./lib/notifications", () => ({ notifyTransitions: vi.fn() }));
vi.mock("./lib/companion-preferences", () => ({
  companionPreferencesRoot: vi.fn(),
  saveCompanionPreferencesSnapshot: vi.fn(),
}));
vi.mock("./lib/state", () => ({ buildState: vi.fn(), eventsPath: vi.fn() }));
vi.mock("./lib/toast", () => ({ showToastIfAvailable: vi.fn() }));
vi.mock("./lib/codex-import-ui", () => ({
  codexImportConflictWarning: vi.fn(),
  invalidCodexImportHookStatus: vi.fn(),
  openCodePulseCenter: vi.fn(),
  runIndependentHookStatusRefresh: vi.fn(),
}));

function createSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: "session-1",
    agent: "codex",
    status: "idle",
    source: "passive",
    projectName: "project",
    title: "project",
    updatedAt: "2026-07-11T05:00:00.000Z",
    ...overrides,
  };
}

function createSnapshot(sessions: SessionRecord[]): StateSnapshot {
  return {
    generatedAt: "2026-07-11T05:00:00.000Z",
    sessions,
    counts: {
      error: sessions.filter((session) => session.status === "error").length,
      waiting: sessions.filter((session) => session.status === "waiting")
        .length,
      running: sessions.filter((session) => session.status === "running")
        .length,
      done: sessions.filter((session) => session.status === "done").length,
      idle: sessions.filter((session) => session.status === "idle").length,
    },
  };
}

async function renderCommand(
  snapshot: StateSnapshot,
  menuBarStyle: Preferences["menuBarStyle"] = "count",
) {
  testState.snapshot = snapshot;
  testState.menuBarStyle = menuBarStyle;
  testState.useStateCall = 0;

  const { default: Command } = await import("./codepulse");
  return Command() as ReturnType<typeof Command> & {
    props: {
      title: string;
      children: unknown[];
    };
  };
}

describe("CodePulse menu bar presentation", () => {
  it("uses delegated sessions in the aggregate title count", async () => {
    const view = await renderCommand(
      createSnapshot([
        createSession({ id: "user", status: "running" }),
        createSession({
          id: "delegated",
          status: "running",
          origin: "delegated",
        }),
      ]),
    );

    expect(view.props.title).toBe("🟢2");
  });

  it("uses a delegated-only project in the session title", async () => {
    const view = await renderCommand(
      createSnapshot([
        createSession({
          id: "delegated-error",
          status: "error",
          origin: "delegated",
          projectName: "delegated-project",
        }),
      ]),
      "session",
    );

    expect(view.props.title).toBe("🔴 delegated-project");
  });

  it("uses global severity for the title and section order", async () => {
    const view = await renderCommand(
      createSnapshot([
        createSession({ id: "idle-user", status: "idle" }),
        createSession({ id: "running-user", status: "running" }),
        createSession({ id: "waiting-user", status: "waiting" }),
        createSession({
          id: "done-delegated",
          status: "done",
          origin: "delegated",
        }),
        createSession({
          id: "error-delegated",
          status: "error",
          origin: "delegated",
        }),
      ]),
    );
    const sections = view.props.children[0] as Array<{
      props: { title: string };
    }>;

    expect(view.props.title).toBe("🔴1");
    expect(sections.map((section) => section.props.title)).toEqual([
      "🔴 委托出错 (1)",
      "🟡 轮到你了 (1)",
      "🟢 运行中 (1)",
      "🔵 委托完成 (1)",
      "⚪ 空闲 (1)",
    ]);
  });
});
