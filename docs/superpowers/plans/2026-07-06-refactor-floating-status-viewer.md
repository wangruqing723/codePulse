---
change: refactor-floating-status-viewer
design-doc: docs/superpowers/specs/2026-07-06-refactor-floating-status-viewer-design.md
base-ref: 0a922ca74ac1d1f23fe6bb56e5158530ebe567ef
---

# Refactor Floating Status Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Electron Floating Companion 重构为深色模式纯状态查看器，只保留每卡片复制路径动作，并把窗口控制收敛为 Pin / Minimize / Close。

**Architecture:** `src/companion/view-model.ts` 先把状态快照适配成 UI-ready 字段；`renderer.tsx` 只渲染这些字段并委托点击事件；`styles.css` 负责暗色视觉、状态圆点、路径截断和紧凑控制；`main.ts` / `preload.ts` 只处理窗口级动作与非 UI recovery IPC。

**Tech Stack:** TypeScript, Electron, Vitest, CSS, existing CodePulse companion modules.

## Global Constraints

- 保持当前 Dark Mode 风格基调。
- Floating Companion 是纯状态查看器，不新增终止进程、打开终端、启动/停止会话等控制操作。
- 每张卡片仅保留一个“复制路径”操作。
- 卡片展示状态只允许四态：`running` 绿色、`done` 蓝色、`error` 红色、`waiting` 黄色。
- `idle` 不进入卡片状态色体系；没有可展示会话时走空态。
- Windows/WSL 复制路径优先使用 UNC `\\wsl$...`，缺失时回退 WSL 路径。
- Raycast Center / CLI recovery 能力可保留，但悬浮窗内不能显示 `force-exit` 或终止类入口。
- 实际 `git commit` 需等待用户明确确认；计划中的 commit 步骤视为检查点和暂存边界。

---

## File Structure

- Modify: `src/companion/view-model.ts` - 增加 UI-ready card/status/path/duration 字段，收敛复制动作。
- Modify: `src/companion/view-model.test.ts` - 覆盖聚合摘要、四态、idle 排除、上下文、时长和 UNC 优先复制。
- Modify: `src/companion/preload.ts` - 收窄 renderer 可用 window action，保留非 UI `forceExitCompanion` recovery。
- Modify: `src/companion/main.ts` - 支持 `pin` / `minimize` / `close`，保留 hover dock 流程和 recovery IPC。
- Modify: `src/companion/main.test.ts` - 覆盖 pin toggle、close、不经 window action 的 force-exit recovery。
- Modify: `src/companion/renderer.tsx` - 重构 header controls 和 session card HTML。
- Modify: `src/companion/renderer.test.ts` - 覆盖新按钮、无旧可见入口、路径 title、复制按钮同行、nested icon click。
- Modify: `src/companion/styles.css` - 深色视觉、四态色、pulse、错误边框、路径行、ghost copy button、上下文行和稳定时长槽。
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md` - 每完成一个任务后勾选对应任务。

### Task 1: View Model State Semantics

**Files:**
- Modify: `src/companion/view-model.test.ts`
- Modify: `src/companion/view-model.ts`
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md`

**Interfaces:**
- Consumes: `SessionRecord`, `StateSnapshot`, `toWslUncPath`.
- Produces: `FloatingSessionViewModel.displayStatus`, `statusTone`, `contextText`, `durationText`, `displayPath`, `fullPath`, `copyAction`; `FloatingViewModel.summaryText` or existing `text` as aggregate summary.

- [x] **Step 1: Write failing view-model tests**

Add tests that assert the new contract. Use existing `createSession()` and `createSnapshot()` helpers.

```ts
it("summarizes only the four display statuses with error first", async () => {
  const { buildFloatingViewModel, statusText } = await loadViewModelModule();
  const snapshot = createSnapshot([
    createSession({ id: "running-1", status: "running" }),
    createSession({ id: "running-2", status: "running" }),
    createSession({ id: "error", status: "error" }),
    createSession({ id: "idle", status: "idle" }),
  ]);

  const model = buildFloatingViewModel?.(snapshot, { platform: "darwin" });

  expect(model?.status).toBe("error");
  expect(statusText?.(model as never)).toBe("🔴 1 错误  🟢 2 运行中");
});

it("filters idle sessions out of card display", async () => {
  const { buildFloatingViewModel } = await loadViewModelModule();
  const model = buildFloatingViewModel?.(
    createSnapshot([
      createSession({ id: "idle", status: "idle" }),
      createSession({ id: "waiting", status: "waiting", title: "等待确认" }),
    ]),
    { platform: "darwin" },
  );

  expect(model?.sessions).toHaveLength(1);
  expect(model?.sessions[0]?.session.id).toBe("waiting");
  expect(model?.sessions[0]?.displayStatus).toBe("waiting");
  expect(model?.sessions[0]?.statusTone).toBe("yellow");
});

it("uses one UNC-first copy action on Windows", async () => {
  const { sessionCopyActions } = await loadViewModelModule();
  const session = createSession({ cwd: "/home/user/project", status: "running" });

  expect(sessionCopyActions?.(session, { platform: "win32", wslDistro: "Ubuntu" })).toEqual([
    {
      id: "copy-unc-path",
      label: "复制路径",
      value: "\\\\wsl$\\Ubuntu\\home\\user\\project",
    },
  ]);
});

it("adds context, duration, and shortened path fields to cards", async () => {
  const { buildFloatingViewModel } = await loadViewModelModule();
  const model = buildFloatingViewModel?.(
    createSnapshot([
      createSession({
        id: "error",
        status: "error",
        cwd: "/Users/wyong/docker/codePulse/plugins/my/plugin-todolist",
        title: "失败任务",
        updatedAt: "2026-07-03T12:00:00.000Z",
      }),
    ]),
    { platform: "darwin", now: new Date("2026-07-03T12:02:14.000Z") } as never,
  );

  expect(model?.sessions[0]?.displayPath).toBe("~/.../my/plugin-todolist");
  expect(model?.sessions[0]?.fullPath).toContain("/Users/wyong/docker/codePulse");
  expect(model?.sessions[0]?.contextText).toBeTruthy();
  expect(model?.sessions[0]?.durationText).toBe("02:14");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/companion/view-model.test.ts`

Expected: FAIL because `displayStatus`, `statusTone`, `contextText`, `durationText`, `displayPath`, `fullPath`, single UNC-first copy action, and aggregate summary are not implemented yet.

- [x] **Step 3: Implement view-model fields**

Update `FloatingViewModelContext` to accept an optional `now?: Date`, add display status/tone helpers, filter idle cards, and derive display fields. Preserve existing `status`, `count`, and `text` fields for compatibility.

```ts
export type DisplaySessionStatus = "running" | "done" | "error" | "waiting";
export type StatusTone = "green" | "blue" | "red" | "yellow";

const STATUS_TONE: Record<DisplaySessionStatus, StatusTone> = {
  running: "green",
  done: "blue",
  error: "red",
  waiting: "yellow",
};
```

Change Windows copy to return a single action:

```ts
const uncPath = context.wslDistro
  ? toWslUncPath(context.wslDistro, session.cwd)
  : undefined;

return [
  {
    id: uncPath ? "copy-unc-path" : "copy-wsl-path",
    label: "复制路径",
    value: uncPath ?? session.cwd,
  },
];
```

Use `new Date(context.now ?? snapshot?.generatedAt ?? Date.now())` for duration tests. Generate `displayPath` with home-aware middle truncation; map `/Users/<name>/...` to `~/.../<last-two-or-three-segments>` when path is long.

- [x] **Step 4: Run focused view-model tests**

Run: `npx vitest run src/companion/view-model.test.ts`

Expected: PASS.

- [x] **Step 5: Update OpenSpec task checkbox**

Check off:

```md
- [x] 1.1 Add focused view-model tests for status summary ordering, four-state card display, context text, duration text, and idle exclusion.
- [x] 1.2 Update `src/companion/view-model.ts` to expose UI-ready summary/card fields and Windows UNC-first single copy action.
```

Prepare checkpoint: `git diff -- src/companion/view-model.ts src/companion/view-model.test.ts openspec/changes/refactor-floating-status-viewer/tasks.md`

### Task 2: Window Actions And IPC

**Files:**
- Modify: `src/companion/preload.ts`
- Modify: `src/companion/main.ts`
- Modify: `src/companion/main.test.ts`
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md`

**Interfaces:**
- Consumes: Existing `handleWindowAction`, hover actions, recovery IPC.
- Produces: window action union containing `pin`, `minimize`, `close`, `hover-enter`, `hover-leave`; visible renderer actions limited to `pin`, `minimize`, `close`.

- [x] **Step 1: Write failing main/preload tests**

Add tests beside existing force-exit recovery coverage:

```ts
it("toggles always-on-top when pin window action is requested", async () => {
  const mainModule = await import("./main");
  const fakeWindow = {
    isAlwaysOnTop: vi.fn(() => true),
    setAlwaysOnTop: vi.fn(),
  };

  mainModule.__testing__.resetState();
  mainModule.__testing__.setMainWindow(fakeWindow as never);
  mainModule.__testing__.handleWindowAction("pin" as never);

  expect(fakeWindow.setAlwaysOnTop).toHaveBeenCalledWith(false);
});

it("closes the companion window without invoking force-exit recovery", async () => {
  const mainModule = await import("./main");
  const fakeWindow = { close: vi.fn() };

  mainModule.__testing__.resetState();
  mainModule.__testing__.setMainWindow(fakeWindow as never);
  mainModule.__testing__.handleWindowAction("close" as never);

  expect(fakeWindow.close).toHaveBeenCalledTimes(1);
  expect(processControlMocks.killCompanionProcess).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/companion/main.test.ts`

Expected: FAIL because `pin` and `close` are not supported.

- [x] **Step 3: Update preload action types**

Set `WindowAction` to include:

```ts
type WindowAction = "pin" | "minimize" | "close" | "hover-enter" | "hover-leave";
```

Keep `forceExitCompanion()` and `companion:force-exit` send path for non-UI recovery, but remove `force-exit` routing from `requestWindowAction()`.

- [x] **Step 4: Update main action handling**

Update `WindowAction` in `main.ts`, add `pin` and `close` cases, retain hover cases:

```ts
case "pin": {
  const pinned = mainWindow?.isAlwaysOnTop() ?? false;
  mainWindow?.setAlwaysOnTop(!pinned);
  break;
}
case "close":
  mainWindow?.close();
  break;
```

Do not remove `ipcMain.on("companion:force-exit", ...)`; it remains recovery-only.

- [x] **Step 5: Run focused window tests**

Run: `npx vitest run src/companion/main.test.ts`

Expected: PASS.

- [x] **Step 6: Update OpenSpec task checkbox**

Check off:

```md
- [x] 2.1 Add focused renderer/main/preload tests for `pin`, `minimize`, and `close` actions and for removal of visible `force-exit`/`hide` controls.
- [x] 2.2 Update `src/companion/preload.ts` and `src/companion/main.ts` so the floating window supports pin toggle, minimize, and close while retaining non-UI recovery IPC where needed.
```

Prepare checkpoint: `git diff -- src/companion/preload.ts src/companion/main.ts src/companion/main.test.ts openspec/changes/refactor-floating-status-viewer/tasks.md`

### Task 3: Renderer Markup And Interactions

**Files:**
- Modify: `src/companion/renderer.test.ts`
- Modify: `src/companion/renderer.tsx`
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md`

**Interfaces:**
- Consumes: Task 1 `FloatingSessionViewModel` UI fields and Task 2 window actions.
- Produces: Header buttons `pin`, `minimize`, `close`; card markup with status dot, title, path row, one copy action, context row, duration slot.

- [x] **Step 1: Update renderer tests to new UI contract**

Change existing tests that expect `hide` / `force-exit` so they expect:

```ts
expect(html).toContain('data-action="pin"');
expect(html).toContain('data-action="minimize"');
expect(html).toContain('data-action="close"');
expect(html).not.toContain('data-action="hide"');
expect(html).not.toContain('data-action="force-exit"');
expect(html).toContain('aria-label="置顶"');
expect(html).toContain('aria-label="最小化"');
expect(html).toContain('aria-label="关闭"');
expect(html).toContain('class="status-dot"');
expect(html).toContain('class="session-path-row"');
expect(html).toContain('title="/tmp/project"');
```

Update nested icon click test so the fake button action is `pin` and expected call is `[["pin"]]`.

- [x] **Step 2: Run renderer test to verify it fails**

Run: `npx vitest run src/companion/renderer.test.ts`

Expected: FAIL because markup still renders `hide` and `force-exit` and old card layout.

- [x] **Step 3: Refactor window action constants**

Replace `WINDOW_ACTIONS` with:

```ts
const WINDOW_ACTIONS = [
  { action: "pin", label: "置顶", icon: "📌" },
  { action: "minimize", label: "最小化", icon: "−" },
  { action: "close", label: "关闭", icon: "×" },
] as const;
```

Use icon text or CSS classes consistently. If icon text is used, keep `aria-hidden="true"` on icon span and labels on the button.

- [x] **Step 4: Refactor card HTML**

Render each card as:

```html
<li class="session-item" data-status="running" data-tone="green">
  <div class="session-heading">
    <span class="status-dot" data-status="running" aria-hidden="true"></span>
    <p class="session-agent">Codex</p>
  </div>
  <p class="session-title">...</p>
  <div class="session-path-row">
    <p class="session-path" title="/full/path">~/.../tail</p>
    <button class="copy-action" type="button" data-copy-value="/full/path" aria-label="复制路径">复制路径</button>
  </div>
  <div class="session-context-row">
    <p class="session-context">等待用户确认</p>
    <time class="session-duration">02:14</time>
  </div>
</li>
```

Use escaped values from view-model. When `copyAction` is missing, render a low-contrast `无路径` placeholder without adding another action.

- [x] **Step 5: Update click handling**

Allow only `pin`, `minimize`, and `close` as visible window actions:

```ts
if (action === "pin" || action === "minimize" || action === "close") {
  hoverIntent.onWindowAction(action);
  return;
}
```

Keep hover-enter / hover-leave internal to `createHoverIntentController`.

- [x] **Step 6: Run focused renderer tests**

Run: `npx vitest run src/companion/renderer.test.ts`

Expected: PASS.

- [x] **Step 7: Update OpenSpec task checkbox**

Check off:

```md
- [x] 3.1 Refactor `src/companion/renderer.tsx` card markup for status dot, title, path row, ghost copy action, context row, tooltip, and duration slot.
```

Prepare checkpoint: `git diff -- src/companion/renderer.tsx src/companion/renderer.test.ts openspec/changes/refactor-floating-status-viewer/tasks.md`

### Task 4: CSS Visual Polish

**Files:**
- Modify: `src/companion/styles.css`
- Modify: `src/companion/renderer.test.ts` if class names need one final alignment
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md`

**Interfaces:**
- Consumes: Task 3 class names and data attributes.
- Produces: Dark status viewer polish with four-tone colors, pulse animation, error border, path truncation, ghost copy button, context row, duration slot.

- [ ] **Step 1: Add CSS status tokens**

Add variables near `:root`:

```css
:root {
  --status-green: #34d399;
  --status-blue: #60a5fa;
  --status-red: #f87171;
  --status-yellow: #facc15;
}
```

- [ ] **Step 2: Style new card structure**

Add or update:

```css
.session-item[data-status="error"] {
  border-color: rgba(248, 113, 113, 0.42);
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.1);
}

.session-heading,
.session-path-row,
.session-context-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.session-path-row {
  gap: 8px;
}

.session-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-duration {
  flex: 0 0 42px;
  text-align: right;
}
```

- [ ] **Step 3: Add status dot and pulse**

```css
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--status-blue);
}

.status-dot[data-status="running"] {
  background: var(--status-green);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.35);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(52, 211, 153, 0);
  }
}
```

- [ ] **Step 4: Restyle copy and window buttons**

Make copy action ghost-weight:

```css
.copy-action {
  flex: 0 0 auto;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: transparent;
  color: #cbd5e1;
}
```

Replace old force-exit icon styles with pin/minimize/close styles or icon-text button rules.

- [ ] **Step 5: Run focused tests and CSS smoke scan**

Run: `npx vitest run src/companion/renderer.test.ts src/companion/view-model.test.ts`

Run: `rg -n "force-exit|window-icon-hide|session-status|copy-actions" src/companion`

Expected: tests PASS; rg should not find old visible UI class/action usage in renderer/CSS, but `companion:force-exit` may still appear in recovery IPC paths.

- [ ] **Step 6: Update OpenSpec task checkbox**

Check off:

```md
- [x] 3.2 Refactor `src/companion/styles.css` for dark status viewer polish, four-tone state colors, running pulse animation, error border, path truncation, and stable compact controls.
```

Prepare checkpoint: `git diff -- src/companion/styles.css src/companion/renderer.test.ts openspec/changes/refactor-floating-status-viewer/tasks.md`

### Task 5: Verification And Build Closure

**Files:**
- Modify: `openspec/changes/refactor-floating-status-viewer/tasks.md`
- Optionally create or update: verification notes only if visual inspection cannot be fully completed in this environment.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: all OpenSpec task checkboxes complete and verification evidence ready for Comet build guard.

- [ ] **Step 1: Run focused companion tests**

Run:

```bash
npx vitest run src/companion/view-model.test.ts src/companion/renderer.test.ts src/companion/main.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run project tests if focused tests pass**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run lint, Raycast build, and companion build**

Run:

```bash
npm run lint
npm run build
npm run companion:build
```

Expected: all PASS.

- [ ] **Step 4: Visual inspection**

If GUI launch is available, run `npm run companion:dev` and inspect:

- Header buttons appear in order Pin / Minimize / Close.
- Header summary shows multiple status counts when applicable.
- Running dot pulses green.
- Error card border is subtly red.
- Long paths truncate and expose full path via `title`.
- Copy path is the only card action and sits on the path row.
- Context line and duration do not overlap at the current companion size.

If GUI launch is blocked by sandbox or desktop constraints, record that platform visual inspection is deferred and include the exact blocker in the final verification summary.

- [ ] **Step 5: Mark verification tasks**

Check off:

```md
- [x] 4.1 Run focused companion unit tests covering view-model, renderer, and main window actions.
- [x] 4.2 Run `npm run lint`, `npm run build`, and `npm run companion:build`.
- [x] 4.3 Launch or otherwise visually inspect the companion layout and record any unverified platform-specific residual risk.
```

- [ ] **Step 6: Final diff review before asking for commit confirmation**

Run:

```bash
git diff --check
git diff --stat
git diff -- src/companion/view-model.ts src/companion/renderer.tsx src/companion/preload.ts src/companion/main.ts src/companion/styles.css
```

Expected: no whitespace errors; diff scope stays inside companion UI/view-model/window action files plus OpenSpec tasks and Comet docs.

## Self-Review

- Spec coverage: the plan maps OpenSpec card state, status summary, Pin / Minimize / Close, copy path, path truncation, read-only context, duration slot, dark style, and no visible force-exit/hide controls to Tasks 1-5.
- Placeholder scan: no TBD/TODO/fill-in placeholders are used; each step names files, commands, and expected outcomes.
- Type consistency: view-model field names used by renderer are introduced in Task 1 and consumed in Task 3; window action names are introduced in Task 2 and consumed in Task 3.
