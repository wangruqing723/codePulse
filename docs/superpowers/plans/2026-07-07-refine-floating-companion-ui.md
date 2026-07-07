---
change: refine-floating-companion-ui
design-doc: docs/superpowers/specs/2026-07-07-refine-floating-companion-ui-design.md
base-ref: e673caa8ad20b9924e2dc68c5e6aa9c68358b7d2
---

# Refine Floating Companion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the Electron Floating Companion header and session cards denser, clearer, and safer to click while preserving its read-only state-viewer role.

**Architecture:** Keep the existing companion boundaries. `main.ts` owns Electron window state, `view-model.ts` normalizes render-ready data, `renderer.tsx` owns DOM and event delegation, and `styles.css` owns compact dark-mode presentation.

**Tech Stack:** TypeScript, Electron, DOM event delegation, CSS, Vitest, existing npm scripts.

## Global Constraints

- Floating Companion remains a pure state viewer.
- Per-card actions are limited to copying the session path.
- Status colors are fixed: running green, completed blue, error red, waiting yellow.
- Header controls are limited to pin, minimize, and close.
- Do not change transcript scanning, hook ingestion, companion bootstrap, packaging, or publishing logic.

---

### Task 1: View Model And Pin State

**Files:**
- Modify: `src/companion/view-model.ts`
- Modify: `src/companion/view-model.test.ts`
- Modify: `src/companion/main.ts`
- Modify: `src/companion/main.test.ts`

**Interfaces:**
- Produces: `FloatingViewModel.isPinned?: boolean`
- Produces: `FloatingViewModel.summaryItems?: FloatingStatusSummaryItem[]`
- Consumes: `BrowserWindow.isAlwaysOnTop()` from Electron main process

- [x] **Step 1: Write failing view-model tests**

Add tests proving `buildFloatingViewModel()` returns ordered `summaryItems` for mixed statuses and leaves `contextText` undefined when running/done context would duplicate the title.

Run: `npm test -- src/companion/view-model.test.ts`
Expected before implementation: tests fail because `summaryItems` and context de-duplication are missing.

- [x] **Step 2: Implement view-model fields**

Update `FloatingViewModelContext`, `FloatingViewModel`, and helper logic so:

```ts
export interface FloatingStatusSummaryItem {
  status: DisplaySessionStatus;
  statusTone: StatusTone;
  count: number;
  label: string;
}
```

`buildFloatingViewModel()` must assign `isPinned: context.isPinned` and `summaryItems: statusSummaryItems(sessions)`.

- [x] **Step 3: Write failing main-process test**

Add a test where `handleWindowAction("pin")` toggles always-on-top and publishes a view model containing `isPinned: false` or `true`.

Run: `npm test -- src/companion/main.test.ts`
Expected before implementation: test fails because pin does not publish updated state.

- [x] **Step 4: Implement main-process pin propagation**

Add a `currentPinState()` helper and pass `isPinned` into every `buildFloatingViewModel()` call in `refreshModel()`. In `handleWindowAction("pin")`, call `setAlwaysOnTop(nextPinned)` and immediately `publishModel({ ...currentModel, isPinned: nextPinned })`.

- [x] **Step 5: Verify Task 1**

Run: `npm test -- src/companion/view-model.test.ts src/companion/main.test.ts`
Expected: PASS.

### Task 2: Header And Window Controls

**Files:**
- Modify: `src/companion/renderer.tsx`
- Modify: `src/companion/renderer.test.ts`
- Modify: `src/companion/styles.css`

**Interfaces:**
- Consumes: `FloatingViewModel.summaryItems`
- Consumes: `FloatingViewModel.isPinned`
- Produces: renderer DOM with `data-action="pin|minimize|close"` only

- [x] **Step 1: Write failing renderer tests for Header**

Add tests proving:

- Header status summary renders structured one-line items.
- Pin active state renders `aria-pressed="true"` and `data-active="true"`.
- Inactive pin renders `aria-pressed="false"` and outline icon.
- Header does not render `drag-handle` or `drag-region` placeholder markup.

Run: `npm test -- src/companion/renderer.test.ts`
Expected before implementation: tests fail.

- [x] **Step 2: Implement Header rendering**

Add `renderHeaderStatus(model)` and `renderWindowActions(model)`. Pin should render custom SVG for active and inactive states; minimize and close remain icon-only controls.

- [x] **Step 3: Implement Header/control CSS**

Add CSS for:

- `.status-summary` using flex, `flex-wrap: nowrap`, and `white-space: nowrap`.
- `.summary-dot` fixed to 12px.
- `.window-button[data-action="pin"][data-active="true"]` using subtle white active background.
- `.window-icon, .copy-icon { pointer-events: none; }`
- Hover feedback using `background-color: rgba(255, 255, 255, 0.1)`.

- [x] **Step 4: Verify Task 2**

Run: `npm test -- src/companion/renderer.test.ts`
Expected: PASS.

### Task 3: Compact Session Cards

**Files:**
- Modify: `src/companion/renderer.tsx`
- Modify: `src/companion/renderer.test.ts`
- Modify: `src/companion/styles.css`

**Interfaces:**
- Consumes: `FloatingSessionViewModel.durationText`
- Consumes: `FloatingSessionViewModel.displayPath`
- Consumes: `FloatingSessionViewModel.fullPath`
- Produces: two-row session card DOM with optional context row only for meaningful error/waiting context

- [x] **Step 1: Write failing card layout tests**

Add tests proving:

- Card first row contains status dot, title, agent, separator, and duration.
- Card second row contains path and copy button.
- `session-context-row` is absent when `contextText` is empty.
- CSS `.session-item` has no `min-height`, no `flex-grow`, and no `justify-content: space-between`.

Run: `npm test -- src/companion/renderer.test.ts`
Expected before implementation: tests fail.

- [x] **Step 2: Implement two-row card DOM**

Replace old heading/title/context layout with:

```html
<div class="session-top-row">
  <div class="session-title-group">...</div>
  <div class="session-meta">Codex · 02:14</div>
</div>
<div class="session-path-row">...</div>
```

Render `session-context-row` only when `contextText` exists.

- [x] **Step 3: Implement compact card CSS**

Set:

```css
.session-list {
  grid-auto-rows: max-content;
  align-content: flex-start;
  align-items: start;
  gap: 8px;
}

.session-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: fit-content;
  padding: 12px 16px;
  border-radius: 8px;
}
```

Every row-level selector must include `align-items: center`.

- [x] **Step 4: Verify Task 3**

Run: `npm test -- src/companion/renderer.test.ts`
Expected: PASS.

### Task 4: Copy Path Interaction

**Files:**
- Modify: `src/companion/renderer.tsx`
- Modify: `src/companion/renderer.test.ts`
- Modify: `src/companion/styles.css`

**Interfaces:**
- Consumes: `navigator.clipboard.writeText(path)`
- Consumes fallback: `bridge.copyText(path)`
- Produces: icon-only `.copy-action` with temporary `data-copied="true"`

- [x] **Step 1: Write failing copy interaction tests**

Add tests proving:

- Clicking an inner copy SVG resolves the parent `[data-copy-value]`.
- `navigator.clipboard.writeText(path)` is called first.
- Electron bridge fallback remains available.
- `data-copied="true"` is removed after the configured feedback timeout.

Run: `npm test -- src/companion/renderer.test.ts`
Expected before implementation: tests fail.

- [x] **Step 2: Implement copy button DOM and logic**

Render the copy button as a 22px icon-only button with `title="复制路径"`. In `bindInteractions()`, resolve `target.closest("[data-copy-value]")`, call `navigator.clipboard.writeText(value)` when available, otherwise call `bridge.copyText(value)`, then set and clear `data-copied`.

- [x] **Step 3: Implement copy feedback CSS**

Add `.copy-action[data-copied="true"]` and `@keyframes copy-success`. Keep the animation transform-only and box-shadow-only so it does not affect layout.

- [x] **Step 4: Verify Task 4**

Run: `npm test -- src/companion/renderer.test.ts`
Expected: PASS.

### Task 5: Final Verification And Task Checkoff

**Files:**
- Modify: `openspec/changes/refine-floating-companion-ui/tasks.md`
- Verify: all files touched by Tasks 1-4

**Interfaces:**
- Produces: checked OpenSpec task list after implementation evidence is available

- [x] **Step 1: Run full unit suite**

Run: `npm test`
Expected: all test files pass.

- [x] **Step 2: Run lint**

Run: `npm run lint`
Expected: lint exits 0.

- [x] **Step 3: Run Raycast build**

Run: `npm run build`
Expected: build exits 0.

- [x] **Step 4: Run companion build**

Run: `npm run companion:build`
Expected: companion build exits 0.

- [x] **Step 5: Run whitespace check**

Run: `git diff --check`
Expected: no whitespace errors.

- [x] **Step 6: Mark OpenSpec tasks complete**

After the verification commands above pass, update `openspec/changes/refine-floating-companion-ui/tasks.md` by changing every implemented checkbox from `- [x]` to `- [x]`.
