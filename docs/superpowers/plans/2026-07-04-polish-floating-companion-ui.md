---
change: polish-floating-companion-ui
design-doc: docs/superpowers/specs/2026-07-04-polish-floating-companion-ui-design.md
base-ref: f6d611ca49871bd08e2b8af912b03eb9180e2489
---

# Polish Floating Companion UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix floating companion icon-button clicks and make the companion honor Raycast monitoring preferences.

**Architecture:** Renderer clicks resolve actions through the nearest ancestor with `data-action`, preserving the existing bridge contract. Raycast writes a small preference snapshot to its support path; companion refresh reads that snapshot and merges it over environment/default fallback preferences.

**Tech Stack:** TypeScript, Electron renderer/main process, Raycast API, Vitest.

## Global Constraints

- Do not make Electron companion depend on Raycast APIs directly.
- Keep existing `data-action` window action names: `hide`, `minimize`, `force-exit`.
- Preserve fallback behavior: environment variables first when no snapshot exists, default active window remains 5 minutes.
- Do not change state inference, WSL path conversion, or path copy semantics.

---

### Task 1: Renderer Icon Click Delegation

**Files:**
- Modify: `src/companion/renderer.tsx`
- Modify: `src/companion/renderer.test.ts`
- Modify: `openspec/changes/polish-floating-companion-ui/tasks.md`

**Interfaces:**
- Consumes: existing `CompanionBridge.requestWindowAction(action)` contract.
- Produces: renderer click handling that resolves nested icon clicks through `[data-action]`.

- [x] **Step 1: Write the failing test**

Add a renderer test that renders the HTML, binds interactions, clicks the nested icon span inside each action button, and expects the bridge to receive the matching action.

Expected test shape:

```typescript
it("handles clicks on nested window action icons", async () => {
  document.body.innerHTML = '<main id="root"></main>';
  const root = document.getElementById("root") as HTMLElement;
  const requestWindowAction = vi.fn();
  const bridge = {
    copyText: vi.fn(),
    getState: vi.fn(),
    requestWindowAction,
    subscribe: vi.fn(),
  };

  root.innerHTML = renderFloatingHtml(createModel({}));
  bindInteractions(root, bridge as never);

  root.querySelector(".window-icon-hide")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  root.querySelector(".window-icon-minimize")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  root.querySelector(".window-icon-force-exit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(requestWindowAction.mock.calls).toEqual([
    ["hide"],
    ["minimize"],
    ["force-exit"],
  ]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/companion/renderer.test.ts`

Expected: FAIL because nested icon clicks do not call `requestWindowAction`.

- [x] **Step 3: Write minimal implementation**

Export or otherwise test the existing `bindInteractions` helper, and update the click handler to use:

```typescript
const actionTarget = target.closest<HTMLElement>("[data-action]");
const action = actionTarget?.dataset.action;
```

Only call `onWindowAction` when `action` is one of `hide`, `minimize`, or `force-exit`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/companion/renderer.test.ts`

Expected: PASS.

- [x] **Step 5: Mark OpenSpec task**

Check off `2.1` in `openspec/changes/polish-floating-companion-ui/tasks.md`.

### Task 2: Raycast Preference Snapshot Sync

**Files:**
- Create: `src/lib/companion-preferences.ts`
- Create: `src/lib/companion-preferences.test.ts`
- Modify: `src/codepulse.tsx`
- Modify: `src/setup-hooks.tsx`
- Modify: `src/companion/main.ts`
- Modify: `src/companion/main.test.ts`
- Modify: `openspec/changes/polish-floating-companion-ui/tasks.md`

**Interfaces:**
- Produces: `companionPreferencesSnapshotPath(root: string): string`
- Produces: `saveCompanionPreferencesSnapshot(root: string, preferences: Preferences): Promise<void>`
- Produces: `loadCompanionPreferencesSnapshot(root: string): Promise<Preferences | undefined>`
- Produces: `resolveCompanionPreferences(root: string, fallback: Preferences): Promise<Preferences>`
- Consumes: existing `Preferences` type with `activeWindowMinutes` and `monitorProjects`.

- [x] **Step 1: Write failing preference snapshot tests**

Create `src/lib/companion-preferences.test.ts` with tests for:

```typescript
it("loads snapshot preferences over fallback values", async () => {
  await saveCompanionPreferencesSnapshot(root, {
    activeWindowMinutes: "30",
    monitorProjects: "/Users/me/project",
  });

  await expect(resolveCompanionPreferences(root, {
    activeWindowMinutes: "5",
    monitorProjects: undefined,
  })).resolves.toEqual({
    activeWindowMinutes: "30",
    monitorProjects: "/Users/me/project",
  });
});
```

Also test missing snapshot returns fallback, and malformed JSON returns fallback.

- [x] **Step 2: Run snapshot tests to verify they fail**

Run: `npm test -- --run src/lib/companion-preferences.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement snapshot module**

Create `src/lib/companion-preferences.ts`:

```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Preferences } from "./types";

const SNAPSHOT_FILE = "companion-preferences.json";

export function companionPreferencesSnapshotPath(root: string): string {
  return path.join(root, SNAPSHOT_FILE);
}

function cleanPreferences(preferences: Preferences): Preferences {
  return {
    activeWindowMinutes: preferences.activeWindowMinutes,
    monitorProjects: preferences.monitorProjects,
  };
}

export async function saveCompanionPreferencesSnapshot(root: string, preferences: Preferences): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    companionPreferencesSnapshotPath(root),
    `${JSON.stringify(cleanPreferences(preferences), null, 2)}\n`,
    "utf8",
  );
}

export async function loadCompanionPreferencesSnapshot(root: string): Promise<Preferences | undefined> {
  try {
    const parsed = JSON.parse(await readFile(companionPreferencesSnapshotPath(root), "utf8")) as Preferences;
    return cleanPreferences(parsed);
  } catch {
    return undefined;
  }
}

export async function resolveCompanionPreferences(root: string, fallback: Preferences): Promise<Preferences> {
  const snapshot = await loadCompanionPreferencesSnapshot(root);
  return {
    activeWindowMinutes: snapshot?.activeWindowMinutes ?? fallback.activeWindowMinutes,
    monitorProjects: snapshot?.monitorProjects ?? fallback.monitorProjects,
  };
}
```

- [x] **Step 4: Wire Raycast commands and companion refresh**

In `src/codepulse.tsx`, after `getPreferenceValues<Preferences>()`, write the snapshot to `environment.supportPath` during refresh before `buildState`.

In `src/setup-hooks.tsx`, write the same snapshot when the setup view loads, so opening CodePulse Center also updates companion preferences.

In `src/companion/main.ts`, replace direct use of `DEFAULT_PREFERENCES` in `refreshModel()` with:

```typescript
const preferences = await resolveCompanionPreferences(stateRoot(), DEFAULT_PREFERENCES);
```

Pass `preferences` into `resolveCompanionStateSource`.

- [x] **Step 5: Add main refresh test**

Update `src/companion/main.test.ts` mocks so a test can assert `resolveCompanionPreferences` is called with `"/tmp/codepulse/state"` and fallback preferences, and that `resolveCompanionStateSource` receives the resolved `activeWindowMinutes: "30"` value.

- [x] **Step 6: Run targeted tests**

Run:

```bash
npm test -- --run src/lib/companion-preferences.test.ts src/companion/main.test.ts
```

Expected: PASS.

- [x] **Step 7: Mark OpenSpec task**

Check off `2.2` in `openspec/changes/polish-floating-companion-ui/tasks.md`.

### Task 3: Full Verification

**Files:**
- Modify: `openspec/changes/polish-floating-companion-ui/tasks.md`

**Interfaces:**
- Consumes: all previous tasks complete.
- Produces: full build/test evidence for Comet build guard.

- [x] **Step 1: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 2: Run lint**

Run: `npm run lint`

Expected: ESLint and Prettier pass.

- [x] **Step 3: Run builds**

Run:

```bash
npm run build
npm run companion:build
```

Expected: both builds pass.

- [x] **Step 4: Validate OpenSpec**

Run: `openspec validate polish-floating-companion-ui`

Expected: PASS.

- [x] **Step 5: Mark OpenSpec task**

Check off `2.3` in `openspec/changes/polish-floating-companion-ui/tasks.md`.
