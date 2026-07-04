/// <reference lib="dom" />

import { AGENT_LABEL, STATUS_LABEL } from "../lib/types";
import type { CompanionBridge } from "./preload";
import type { FloatingSessionViewModel, FloatingViewModel } from "./view-model";

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
  { action: "hide", label: "隐藏", iconClass: "window-icon-hide" },
  { action: "minimize", label: "最小化", iconClass: "window-icon-minimize" },
  {
    action: "force-exit",
    label: "强制退出",
    iconClass: "window-icon-force-exit",
  },
] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCopyActions(session: FloatingSessionViewModel): string {
  if (session.copyActions.length === 0) {
    return '<span class="session-copy-empty">无路径</span>';
  }

  return session.copyActions
    .map(
      (action) => `
        <button
          class="copy-action"
          type="button"
          data-copy-value="${escapeHtml(action.value)}"
        >
          ${escapeHtml(action.label)}
        </button>
      `,
    )
    .join("");
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
      ${model.sessions
        .map(
          ({ session, copyActions }) => `
            <li class="session-item">
              <div class="session-meta">
                <span class="session-agent">${escapeHtml(AGENT_LABEL[session.agent])}</span>
                <span class="session-status">${escapeHtml(STATUS_LABEL[session.status])}</span>
              </div>
              <p class="session-title">${escapeHtml(session.title)}</p>
              <p class="session-path" title="${escapeHtml(session.cwd ?? "")}">
                ${escapeHtml(session.cwd ?? session.projectName)}
              </p>
              <div class="copy-actions">
                ${renderCopyActions({ session, copyActions })}
              </div>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderWindowActions(): string {
  return WINDOW_ACTIONS.map(
    ({ action, label, iconClass }) => `
      <button
        type="button"
        class="window-button"
        data-action="${action}"
        aria-label="${label}"
        title="${label}"
      >
        <span class="window-icon ${iconClass}" aria-hidden="true"></span>
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
  onWindowAction(action: "force-exit" | "hide" | "minimize"): void;
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
    if (action === "force-exit" || action === "hide" || action === "minimize") {
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
