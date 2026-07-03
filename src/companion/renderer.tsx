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

export function renderFloatingHtml(model: FloatingViewModel): string {
  return `
    <section class="shell" data-status="${escapeHtml(model.status)}">
      <header class="header drag-region">
        <div class="header-copy">
          <p class="eyebrow">CodePulse</p>
          <h1 class="status-text">${escapeHtml(model.text)}</h1>
        </div>
        <div class="window-actions no-drag">
          <button type="button" class="window-button" data-action="hide">隐藏</button>
          <button type="button" class="window-button" data-action="minimize">最小化</button>
        </div>
      </header>
      ${renderSessions(model)}
    </section>
  `;
}

function renderIntoRoot(root: HTMLElement, model: FloatingViewModel): void {
  root.innerHTML = renderFloatingHtml(model);
}

function bindInteractions(root: HTMLElement, bridge: CompanionBridge): void {
  root.addEventListener("mouseenter", () => {
    bridge.requestWindowAction("hover-enter");
  });
  root.addEventListener("mouseleave", () => {
    bridge.requestWindowAction("hover-leave");
  });
  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "hide" || action === "minimize") {
      bridge.requestWindowAction(action);
      return;
    }

    const value = target.dataset.copyValue;
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
