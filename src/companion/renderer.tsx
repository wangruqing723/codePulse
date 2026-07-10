/// <reference lib="dom" />

import { sessionAgentLabel } from "../lib/session-labels";
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
  isPinned: true,
  text: "暂无活跃会话",
  sessions: [],
};
const HOVER_LEAVE_DELAY_MS = 260;
const COPY_FEEDBACK_MS = 900;
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

function isDisplaySessionStatus(
  status: string | undefined,
): status is DisplaySessionStatus {
  return (
    status === "running" ||
    status === "done" ||
    status === "error" ||
    status === "waiting"
  );
}

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
  const displayPath =
    session.displayPath ?? fullPath ?? session.session.projectName;

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
          title="${escapeHtml(copyAction.label)}"
        >
          <svg
            class="copy-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M5 2.5A1.5 1.5 0 0 1 6.5 1h5A1.5 1.5 0 0 1 13 2.5v5A1.5 1.5 0 0 1 11.5 9H11V6.5A2.5 2.5 0 0 0 8.5 4H5v-1.5Z"
              fill="currentColor"
              opacity="0.55"
            />
            <path
              d="M3 5h5.5A1.5 1.5 0 0 1 10 6.5V12a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V6.5A1.5 1.5 0 0 1 3 5Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
  `;
}

function renderSessionCard(session: FloatingSessionViewModel): string {
  const displayStatus = session.displayStatus ?? session.session.status;
  if (!isDisplaySessionStatus(displayStatus)) {
    return "";
  }

  const statusTone = session.statusTone ?? STATUS_TONE_FALLBACK[displayStatus];
  const contextText = session.contextText ?? "";
  const durationText = session.durationText ?? "00:00";
  const contextRow = contextText
    ? `
      <div class="session-context-row">
        <p class="session-context">${escapeHtml(contextText)}</p>
      </div>
    `
    : "";

  return `
    <li
      class="session-item"
      data-status="${escapeHtml(displayStatus)}"
      data-tone="${escapeHtml(statusTone)}"
    >
      <div class="session-top-row">
        <div class="session-title-group">
          <span
            class="status-dot"
            data-status="${escapeHtml(displayStatus)}"
            aria-hidden="true"
          ></span>
          <p class="session-title">${escapeHtml(session.session.title)}</p>
        </div>
        <div class="session-meta">
          <span class="session-agent">${escapeHtml(sessionAgentLabel(session.session))}</span>
          <span class="session-meta-separator" aria-hidden="true">·</span>
          <time class="session-duration">${escapeHtml(durationText)}</time>
        </div>
      </div>
      ${renderPathRow(session)}
      ${contextRow}
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
      ${model.sessions
        .map((session) => renderSessionCard(session))
        .filter(Boolean)
        .join("")}
    </ul>
  `;
}

function renderHeaderStatus(model: FloatingViewModel): string {
  const summaryItems = model.summaryItems ?? [];
  if (summaryItems.length === 0) {
    return `<h1 class="status-text">${escapeHtml(model.text)}</h1>`;
  }

  return `
            <h1 class="status-text status-summary" aria-label="${escapeHtml(
              model.text,
            )}">
              ${summaryItems
                .map(
                  (item) => `
                    <span class="status-summary-item" data-tone="${escapeHtml(
                      item.statusTone,
                    )}">
                      <span class="summary-dot" aria-hidden="true"></span>
                      <span class="summary-count">${escapeHtml(
                        item.count.toString(),
                      )}</span>
                      <span class="summary-label">${escapeHtml(item.label)}</span>
                    </span>
                  `,
                )
                .join("")}
            </h1>
  `;
}

function renderPinIcon(isPinned: boolean): string {
  if (isPinned) {
    return `
          <svg
            class="window-icon window-icon-pin pin-solid"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M12 2.5 16.8 7.3 14.2 9.9 17.4 13.1 15.9 14.6 13 11.7 8.6 16.1 8.1 20.2 6.6 21.7 2.3 17.4 3.8 15.9 7.9 15.4 12.3 11 9.4 8.1 10.9 6.6 14.1 9.8 16.7 7.2 12 2.5Z"
              fill="currentColor"
            />
          </svg>
    `;
  }

  return `
          <svg
            class="window-icon window-icon-pin pin-outline"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M14.6 4.1 19.9 9.4 17.2 12.1 18.5 13.4 17.2 14.7 13.8 11.3 9.7 15.4 9.1 18.7 7.8 20 4 16.2 5.3 14.9 8.6 14.3 12.7 10.2 9.3 6.8 10.6 5.5 11.9 6.8 14.6 4.1Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>
    `;
}

function renderWindowIcon(
  action: WindowAction,
  icon: string,
  isPinned: boolean,
): string {
  if (action === "pin") {
    return renderPinIcon(isPinned);
  }

  return `<span class="window-icon" aria-hidden="true">${escapeHtml(icon)}</span>`;
}

function renderWindowActions(model: FloatingViewModel): string {
  const isPinned = model.isPinned ?? false;
  return WINDOW_ACTIONS.map(
    ({ action, label, icon }) => `
      <button
        type="button"
        class="window-button"
        data-action="${escapeHtml(action)}"
        ${
          action === "pin"
            ? `data-active="${isPinned ? "true" : "false"}" aria-pressed="${
                isPinned ? "true" : "false"
              }"`
            : ""
        }
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        ${renderWindowIcon(action, icon, isPinned)}
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
            ${renderHeaderStatus(model)}
          </div>
        </div>
        <div class="window-actions no-drag">
          ${renderWindowActions(model)}
        </div>
      </header>
      ${renderSessions(model)}
    </section>
  `;
}

function measureContentHeight(root: HTMLElement): number {
  // .shell 是内容根，用 scrollHeight 拿到不受窗口裁剪的真实内容高度。
  const shell = root.querySelector<HTMLElement>(".shell");
  return shell?.scrollHeight ?? root.scrollHeight;
}

function reportContentHeight(
  root: HTMLElement,
  bridge: Pick<CompanionBridge, "reportContentHeight">,
): void {
  const height = measureContentHeight(root);
  if (height > 0) {
    bridge.reportContentHeight(height);
  }
}

function renderIntoRoot(
  root: HTMLElement,
  model: FloatingViewModel,
  bridge?: Pick<CompanionBridge, "reportContentHeight">,
): void {
  root.innerHTML = renderFloatingHtml(model);
  if (bridge) {
    // 布局落定后再测量，确保拿到换行、折叠后的最终高度。
    requestAnimationFrame(() => {
      reportContentHeight(root, bridge);
    });
  }
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
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        copyTarget.dataset.copied = "true";
        setTimeout(() => {
          delete copyTarget.dataset.copied;
        }, COPY_FEEDBACK_MS);
        return;
      }

      await bridge.copyText(value);
      copyTarget.dataset.copied = "true";
      setTimeout(() => {
        delete copyTarget.dataset.copied;
      }, COPY_FEEDBACK_MS);
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
  renderIntoRoot(root, initialModel, bridge);
  const unsubscribe = bridge.subscribe((model) => {
    renderIntoRoot(root, model, bridge);
  });

  bridge.getState().then((model) => {
    if (model) {
      renderIntoRoot(root, model, bridge);
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
