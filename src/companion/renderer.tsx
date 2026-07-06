/// <reference lib="dom" />

import { AGENT_LABEL } from "../lib/types";
import type { CompanionBridge } from "./preload";
import type {
  DisplaySessionStatus,
  FloatingSessionViewModel,
  FloatingViewModel,
  StatusTone,
} from "./view-model";

declare global {
  interface Window {
    codePulseCompanion?: CompanionBridge;
  }
}

const initialModel: FloatingViewModel = {
  status: "empty",
  count: 0,
  text: "暂无活跃会话",
  sessions: [],
};
const HOVER_LEAVE_DELAY_MS = 260;
const WINDOW_ACTIONS = [
  { action: "pin", label: "置顶", icon: "📌" },
  { action: "minimize", label: "最小化", icon: "−" },
  { action: "close", label: "关闭", icon: "×" },
] as const;

type WindowAction = (typeof WINDOW_ACTIONS)[number]["action"];

const STATUS_TONE_FALLBACK: Record<DisplaySessionStatus, StatusTone> = {
  running: "green",
  done: "blue",
  error: "red",
  waiting: "yellow",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPathRow(session: FloatingSessionViewModel): string {
  const copyAction = session.copyAction ?? session.copyActions[0];
  const fullPath = session.fullPath ?? copyAction?.value ?? session.session.cwd;
  const displayPath = session.displayPath ?? fullPath ?? session.session.projectName;

  if (!copyAction || !fullPath || !displayPath) {
    return `
      <div class="session-path-row">
        <span class="session-copy-empty">无路径</span>
      </div>
    `;
  }

  return `
      <div class="session-path-row">
        <p class="session-path" title="${escapeHtml(fullPath)}">
          ${escapeHtml(displayPath)}
        </p>
        <button
          class="copy-action"
          type="button"
          data-copy-value="${escapeHtml(copyAction.value)}"
          aria-label="${escapeHtml(copyAction.label)}"
        >
          ${escapeHtml(copyAction.label)}
        </button>
      </div>
  `;
}

function renderSessionCard(session: FloatingSessionViewModel): string {
  const displayStatus = session.displayStatus ?? session.session.status;
  const statusTone =
    session.statusTone ??
    (displayStatus === "idle" ? "blue" : STATUS_TONE_FALLBACK[displayStatus]);
  const contextText =
    session.contextText ?? session.session.title ?? AGENT_LABEL[session.session.agent];
  const durationText = session.durationText ?? "00:00";

  return `
    <li
      class="session-item"
      data-status="${escapeHtml(displayStatus)}"
      data-tone="${escapeHtml(statusTone)}"
    >
      <div class="session-heading">
        <span
          class="status-dot"
          data-status="${escapeHtml(displayStatus)}"
          aria-hidden="true"
        ></span>
        <p class="session-agent">${escapeHtml(AGENT_LABEL[session.session.agent])}</p>
      </div>
      <p class="session-title">${escapeHtml(session.session.title)}</p>
      ${renderPathRow(session)}
      <div class="session-context-row">
        <p class="session-context">${escapeHtml(contextText)}</p>
        <time class="session-duration">${escapeHtml(durationText)}</time>
      </div>
    </li>
  `;
}

function renderSessions(model: FloatingViewModel): string {
  if (model.sessions.length === 0) {
    const detail =
      model.status === "unavailable" && model.unavailableReason
        ? `<p class="state-detail">${escapeHtml(model.unavailableReason)}</p>`
        : "";

    return `
      <section class="empty-state">
        <p class="empty-title">${escapeHtml(model.text)}</p>
        ${detail}
      </section>
    `;
  }

  return `
    <ul class="session-list" aria-label="会话列表">
      ${model.sessions.map((session) => renderSessionCard(session)).join("")}
    </ul>
  `;
}

function renderWindowActions(): string {
  return WINDOW_ACTIONS.map(
    ({ action, label, icon }) => `
      <button
        type="button"
        class="window-button"
        data-action="${escapeHtml(action)}"
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        <span class="window-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      </button>
    `,
  ).join("");
}

export function renderFloatingHtml(model: FloatingViewModel): string {
  return `
    <section class="shell" data-status="${escapeHtml(model.status)}">
      <header class="header">
        <div class="header-main">
          <div class="header-copy">
            <p class="eyebrow">CodePulse</p>
            <h1 class="status-text">${escapeHtml(model.text)}</h1>
          </div>
          <div class="drag-handle drag-region" aria-hidden="true"></div>
        </div>
        <div class="window-actions no-drag">
          ${renderWindowActions()}
        </div>
      </header>
      ${renderSessions(model)}
    </section>
  `;
}

function renderIntoRoot(root: HTMLElement, model: FloatingViewModel): void {
  root.innerHTML = renderFloatingHtml(model);
}

interface HoverIntentController {
  onPointerEnter(): void;
  onPointerLeave(): void;
  onWindowAction(action: WindowAction): void;
}

interface HoverIntentOptions {
  hideDelayMs?: number;
}

export function createHoverIntentController(
  bridge: Pick<CompanionBridge, "requestWindowAction">,
  options: HoverIntentOptions = {},
): HoverIntentController {
  const hideDelayMs = options.hideDelayMs ?? HOVER_LEAVE_DELAY_MS;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let ignorePointerLeaveUntilEnter = false;
  const clearPendingHide = (): void => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  };

  return {
    onPointerEnter() {
      ignorePointerLeaveUntilEnter = false;
      clearPendingHide();
      bridge.requestWindowAction("hover-enter");
    },
    onPointerLeave() {
      if (ignorePointerLeaveUntilEnter) {
        return;
      }

      clearPendingHide();
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        bridge.requestWindowAction("hover-leave");
      }, hideDelayMs);
    },
    onWindowAction(action) {
      ignorePointerLeaveUntilEnter = true;
      clearPendingHide();
      bridge.requestWindowAction(action);
    },
  };
}

export function bindInteractions(
  root: HTMLElement,
  bridge: CompanionBridge,
): void {
  const hoverIntent = createHoverIntentController(bridge);

  root.addEventListener("mouseenter", () => {
    hoverIntent.onPointerEnter();
  });
  root.addEventListener("mouseleave", () => {
    hoverIntent.onPointerLeave();
  });
  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const actionTarget = target.closest<HTMLElement>("[data-action]");
    const action = actionTarget?.dataset.action;
    if (action === "pin" || action === "minimize" || action === "close") {
      hoverIntent.onWindowAction(action);
      return;
    }

    const copyTarget = target.closest<HTMLElement>("[data-copy-value]");
    const value = copyTarget?.dataset.copyValue;
    if (value) {
      await bridge.copyText(value);
    }
  });
}

function bootstrap(): void {
  const root = document.getElementById("app");
  const bridge = window.codePulseCompanion;
  if (!root) {
    return;
  }

  renderIntoRoot(root, initialModel);

  if (!bridge) {
    root.innerHTML = `
      <section class="shell">
        <section class="empty-state">
          <p class="empty-title">Companion bridge unavailable</p>
        </section>
      </section>
    `;
    return;
  }

  bindInteractions(root, bridge);
  const unsubscribe = bridge.subscribe((model) => {
    renderIntoRoot(root, model);
  });

  bridge.getState().then((model) => {
    if (model) {
      renderIntoRoot(root, model);
    }
  });

  window.addEventListener("beforeunload", () => {
    unsubscribe();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
