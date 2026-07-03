---
change: wsl2-monitoring
design-doc: docs/superpowers/specs/2026-07-03-wsl2-monitoring-design.md
base-ref: 9d9fe2904367ae25730ba1aa5dc1ac474a9b3607
---

# WSL2 Monitoring Floating Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-platform Electron floating companion for CodePulse, including Windows + WSL2 monitoring, while keeping the existing macOS Raycast menu-bar, Setup Hooks, and file scanning behavior intact.

**Architecture:** Refactor the existing TypeScript state pipeline so scan roots, event roots, and snapshot roots are injected by platform wrappers. Raycast keeps its existing wrapper; the Electron companion adds a floating `BrowserWindow`, platform-specific state sources, edge-hide window geometry, and clipboard path actions.

**Tech Stack:** TypeScript, React, Vitest, Raycast API, Electron, Node `fs/promises`, Node `child_process`, Electron `BrowserWindow`, Electron IPC, Electron `screen`, Electron `clipboard`.

## Global Constraints

- OpenSpec canonical change: `openspec/changes/wsl2-monitoring`.
- Design doc: `docs/superpowers/specs/2026-07-03-wsl2-monitoring-design.md`.
- Primary companion UX is a floating window with visible status text.
- Floating window supports Windows and macOS.
- Floating window defaults to always-on-top.
- Floating window provides hide/minimize controls.
- Floating window supports edge-hide, hover reveal, and mouse-leave hide.
- Windows Terminal open/focus is out of scope.
- Multi-distro WSL selection is out of scope.
- Windows session actions copy WSL path and Windows UNC path only.
- macOS companion session action copies local path.
- macOS Raycast menu-bar, Setup Hooks, supportPath events, local transcript scanning, notifications, and iTerm2 action must remain compatible.
- Do not run `git commit` until the user explicitly confirms commit permission.

---

## File Structure

- `src/lib/wsl.ts`: WSL2 distro parsing, WSL home parsing, and WSL path to UNC conversion.
- `src/lib/wsl.test.ts`: Pure unit tests for WSL2 parsing and path conversion.
- `src/lib/paths.ts`: Platform-neutral monitor prefix matching.
- `src/lib/paths.test.ts`: Focused tests for POSIX and UNC prefix matching.
- `src/lib/scanners.ts`: Configurable Claude/Codex transcript roots.
- `src/lib/scanners.test.ts`: Existing inference tests plus root override tests.
- `src/lib/state.ts`: Configurable state root and event root; existing `buildState` remains as Raycast wrapper.
- `src/lib/state.test.ts`: Event root, state root, and macOS default compatibility tests.
- `src/lib/hooks.ts`: Configurable hook script event output directory and config paths.
- `src/lib/hooks.test.ts`: Hook script/config tests for macOS default and WSL-local event roots.
- `src/setup-hooks.tsx`: Setup/health view text for companion separation and WSL hook status.
- `src/companion/main.ts`: Electron main process, floating window lifecycle, IPC, refresh loop, state source selection.
- `src/companion/preload.ts`: Safe IPC bridge for renderer.
- `src/companion/renderer.tsx`: Floating window UI.
- `src/companion/view-model.ts`: Pure UI state model for aggregate text, session groups, and path actions.
- `src/companion/view-model.test.ts`: Pure tests for UI state model.
- `src/companion/geometry.ts`: Pure window docking, hide, reveal, and screen-boundary functions.
- `src/companion/geometry.test.ts`: Pure tests for edge-hide behavior.
- `src/companion/state-source.ts`: Platform-specific scan root and event root resolution.
- `src/companion/state-source.test.ts`: Tests for macOS local roots and Windows WSL roots.
- `package.json`: Add companion scripts and dependencies.
- `electron-builder.yml`: Basic cross-platform companion packaging config.
- `.gitignore`: Ignore companion build artifacts.
- `docs/companion.md`: Companion development, packaging, macOS compatibility, and Windows + WSL2 prerequisites.

## Task 1: Shared State Roots And WSL2 Path Utilities

**Files:**
- Create: `src/lib/wsl.ts`
- Create: `src/lib/wsl.test.ts`
- Create: `src/lib/paths.test.ts`
- Modify: `src/lib/paths.ts`
- Modify: `src/lib/scanners.ts`
- Modify: `src/lib/scanners.test.ts`
- Modify: `src/lib/state.ts`
- Modify: `src/lib/state.test.ts`

**Interfaces:**
- Produces: `toWslUncPath(distro: string, wslPath: string): string | undefined`
- Produces: `parseDefaultDistroFromList(output: string): string | undefined`
- Produces: `parseWslHome(output: string): string | undefined`
- Produces: `resolveDefaultWslContext(execFileImpl?: ExecFileLike): Promise<WslContext>`
- Produces: `ScanRoots`, `defaultScanRoots()`, `StateBuildConfig`, `buildStateFromConfig(config)`
- Keeps: `buildState(supportPath, preferences)` behavior for Raycast.

- [x] **Step 1: Write failing WSL tests**

Create `src/lib/wsl.test.ts` with tests for:

```ts
expect(toWslUncPath("Ubuntu", "/home/user/project")).toBe(
  "\\\\wsl$\\Ubuntu\\home\\user\\project",
);
expect(toWslUncPath("Ubuntu", "project")).toBeUndefined();
expect(parseDefaultDistroFromList("* Ubuntu Running 2\n")).toBe("Ubuntu");
expect(parseDefaultDistroFromList("*\u0000 \u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\n")).toBe("Ubuntu");
expect(parseWslHome("/home/user\n")).toBe("/home/user");
```

Run: `npm test -- src/lib/wsl.test.ts`

Expected: FAIL because `src/lib/wsl.ts` does not exist.

- [x] **Step 2: Implement WSL helpers**

Create `src/lib/wsl.ts` with:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WslContext {
  distro: string;
  home: string;
  homeUncPath: string;
}

export type ExecFileLike = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr?: string }>;

function cleanWslOutput(output: string): string {
  return output.replaceAll("\u0000", "").replace(/\r/g, "");
}

export function parseDefaultDistroFromList(output: string): string | undefined {
  const lines = cleanWslOutput(output).split("\n").map((line) => line.trim()).filter(Boolean);
  const defaultLine = lines.find((line) => line.startsWith("*"));
  if (!defaultLine) return undefined;
  return defaultLine.replace(/^\*\s*/, "").trim().split(/\s{2,}|\sRunning|\sStopped/)[0]?.trim() || undefined;
}

export function parseWslHome(output: string): string | undefined {
  const home = cleanWslOutput(output).trim();
  return home.startsWith("/") ? home : undefined;
}

export function toWslUncPath(distro: string, wslPath: string): string | undefined {
  if (!distro || !wslPath.startsWith("/")) return undefined;
  return `\\\\wsl$\\${distro}\\${wslPath.split("/").filter(Boolean).join("\\")}`;
}

async function defaultExecFile(file: string, args: string[]) {
  const result = await execFileAsync(file, args, { windowsHide: true });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function resolveDefaultWslContext(
  execFileImpl: ExecFileLike = defaultExecFile,
): Promise<WslContext> {
  const list = await execFileImpl("wsl.exe", ["-l", "-v"]);
  const distro = parseDefaultDistroFromList(list.stdout);
  if (!distro) throw new Error("Unable to resolve default WSL2 distro");
  const homeResult = await execFileImpl("wsl.exe", ["-d", distro, "sh", "-lc", "printf %s \"$HOME\""]);
  const home = parseWslHome(homeResult.stdout);
  if (!home) throw new Error(`Unable to resolve WSL home for ${distro}`);
  const homeUncPath = toWslUncPath(distro, home);
  if (!homeUncPath) throw new Error(`Unable to convert WSL home for ${distro}`);
  return { distro, home, homeUncPath };
}
```

Run: `npm test -- src/lib/wsl.test.ts`

Expected: PASS.

- [x] **Step 3: Add configurable scanner and state tests**

Add tests proving:

- `matchesMonitorPrefixes("/home/user/project/app", ["/home/user/project"])` is true.
- `matchesMonitorPrefixes("\\\\wsl$\\Ubuntu\\home\\user\\project\\app", ["\\\\wsl$\\Ubuntu\\home\\user\\project"])` is true.
- `scanSessions({ roots })` reads Claude/Codex JSONL fixtures from injected roots.
- `buildStateFromConfig({ stateRoot, eventRoot, scanRoots })` reads hook events from injected `eventRoot` and writes `state.json` under `stateRoot`.
- `buildState(supportPath, preferences)` still uses `eventsPath(supportPath)` by default.

Run:

```bash
npm test -- src/lib/paths.test.ts src/lib/scanners.test.ts src/lib/state.test.ts
```

Expected: FAIL before implementation.

- [x] **Step 4: Implement configurable roots**

Modify `src/lib/paths.ts`, `src/lib/scanners.ts`, and `src/lib/state.ts` so:

- monitor prefix matching normalizes `\` to `/` before boundary checks.
- `ScanOptions` accepts `roots?: Partial<ScanRoots>`.
- `scanSessions` merges `defaultScanRoots()` with injected roots.
- `buildStateFromConfig` accepts `stateRoot`, `eventRoot`, `scanRoots`, `preferences`, and optional `now`.
- existing `buildState(supportPath, preferences)` delegates to `buildStateFromConfig`.

Run:

```bash
npm test -- src/lib/wsl.test.ts src/lib/paths.test.ts src/lib/scanners.test.ts src/lib/state.test.ts
```

Expected: PASS.

## Task 2: Hook Event Roots And macOS Compatibility

**Files:**
- Modify: `src/lib/hooks.ts`
- Modify: `src/lib/hooks.test.ts`
- Modify: `src/setup-hooks.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `HookInstallOptions`
- Keeps: `installHooks(environment.supportPath, target)`, `uninstallHooks(environment.supportPath, target)`, and `getHookInstallStatus(environment.supportPath)` working.
- Adds: Setup view shows companion/WSL status without launching companion.

- [x] **Step 1: Write failing hook event root tests**

Add tests proving:

```ts
const scriptPath = await writeHookScript({
  supportPath: root,
  eventRoot: "/home/user/.codepulse/events",
});
expect(await readFile(scriptPath, "utf8")).toContain(
  'const eventsDir = "/home/user/.codepulse/events";',
);
```

Also test the legacy macOS form:

```ts
const scriptPath = await writeHookScript(root);
expect(await readFile(scriptPath, "utf8")).toContain(
  JSON.stringify(path.join(root, "events")),
);
```

Run: `npm test -- src/lib/hooks.test.ts`

Expected: FAIL before implementation.

- [x] **Step 2: Implement hook options without changing macOS defaults**

Modify `src/lib/hooks.ts`:

```ts
export interface HookInstallOptions {
  supportPath: string;
  eventRoot?: string;
  claudeSettingsPath?: string;
  codexConfigPath?: string;
}

function normalizeHookOptions(input: string | HookInstallOptions): HookInstallOptions {
  return typeof input === "string" ? { supportPath: input } : input;
}
```

Update script content to use `eventRoot ?? path.join(supportPath, "events")`.

Run:

```bash
npm test -- src/lib/hooks.test.ts
npm run build
```

Expected: PASS.

- [x] **Step 3: Update Setup separation copy**

Modify `src/setup-hooks.tsx` to add a non-action health/list item:

- title: `Floating companion`
- Windows subtitle: `独立运行；Raycast 不启动或停止 companion`
- Windows accessory: `WSL events: ~/.codepulse/events`
- macOS subtitle: `Raycast menu-bar 和悬浮窗并行`
- macOS accessory: `Raycast hooks: supportPath/events`

Do not add process spawning, shell commands, or lifecycle management.

Run: `npm run build`

Expected: PASS.

## Task 3: Floating Companion View Model And Geometry

**Files:**
- Create: `src/companion/view-model.ts`
- Create: `src/companion/view-model.test.ts`
- Create: `src/companion/geometry.ts`
- Create: `src/companion/geometry.test.ts`
- Create: `src/companion/state-source.ts`
- Create: `src/companion/state-source.test.ts`

**Interfaces:**
- Produces: `buildFloatingViewModel(snapshot, context)`
- Produces: `statusText(model)`
- Produces: `sessionCopyActions(session, context)`
- Produces: `dockWindow(bounds, displayWorkArea, edge)`
- Produces: `hiddenBounds(bounds, displayWorkArea, edge, visibleSize)`
- Produces: `revealedBounds(hidden, previousFullBounds, displayWorkArea)`
- Produces: `resolveCompanionStateSource(platform, options)`

- [x] **Step 1: Write failing view model tests**

Test:

- waiting dominates running and returns `轮到你了 1 个`.
- running returns `运行中 1 个`.
- WSL unavailable returns `WSL 不可用`.
- Windows session copy actions include WSL and UNC path.
- macOS session copy actions include only local path.

Run: `npm test -- src/companion/view-model.test.ts`

Expected: FAIL before implementation.

- [x] **Step 2: Implement view model**

Create `src/companion/view-model.ts` with pure functions only. It must not import Electron.

Run: `npm test -- src/companion/view-model.test.ts`

Expected: PASS.

- [x] **Step 3: Write failing geometry tests**

Test:

- a window near the right edge docks to the right edge.
- hidden right-edge bounds leave `visibleSize` pixels visible.
- hover reveal restores previous full bounds within work area.
- left, top, and bottom edges do not produce off-screen unreachable windows.

Run: `npm test -- src/companion/geometry.test.ts`

Expected: FAIL before implementation.

- [x] **Step 4: Implement geometry helpers**

Create `src/companion/geometry.ts` with plain `{ x, y, width, height }` types and no Electron imports.

Run: `npm test -- src/companion/geometry.test.ts`

Expected: PASS.

- [x] **Step 5: Add state source tests and implementation**

Test that:

- `darwin` source uses default local scan roots and no WSL UNC conversion.
- `win32` source uses `resolveDefaultWslContext` and creates WSL UNC scan/event roots.
- WSL failure returns unavailable reason instead of throwing through the refresh loop.

Run: `npm test -- src/companion/state-source.test.ts`

Expected: PASS after implementation.

## Task 4: Electron Floating Window

**Files:**
- Create: `src/companion/main.ts`
- Create: `src/companion/preload.ts`
- Create: `src/companion/renderer.tsx`
- Create: `src/companion/styles.css`
- Modify: `package.json`
- Modify: `tsconfig.json` if companion renderer needs JSX inclusion changes.

**Interfaces:**
- Consumes: `buildStateFromConfig`
- Consumes: `resolveCompanionStateSource`
- Consumes: `buildFloatingViewModel`
- Consumes: `geometry` helpers
- Produces scripts: `companion:dev`, `companion:build`

- [x] **Step 1: Add Electron dependency and build scripts**

Run:

```bash
npm install --save-dev electron esbuild
```

If network is blocked by sandbox, request escalation with a clear npm install justification.

Add scripts:

```json
{
  "companion:build": "node scripts/build-companion.mjs",
  "companion:dev": "npm run companion:build && electron dist-companion/main.cjs"
}
```

If adding `scripts/build-companion.mjs`, include main, preload, renderer, CSS, and asset copy steps explicitly.

- [x] **Step 2: Implement main process**

`src/companion/main.ts` must:

- create a `BrowserWindow` with `alwaysOnTop: true`.
- load the built renderer.
- run refresh every 5 seconds.
- send view model updates via IPC.
- handle hide/minimize requests.
- handle drag-end/dock requests and mouse-enter/mouse-leave dock transitions.
- never spawn or manage Raycast.

Run: `npm run companion:build`

Expected: PASS.

- [x] **Step 3: Implement renderer**

Renderer must show:

- large aggregate status text.
- compact session list.
- hide/minimize buttons.
- per-session copy actions.
- error/empty states.

Text must fit in the fixed floating window on common desktop widths. Avoid cards nested inside cards.

Run:

```bash
npm test -- src/companion/view-model.test.ts src/companion/geometry.test.ts
npm run companion:build
```

Expected: PASS.

- [x] **Step 4: Manual dev check**

Run `npm run companion:dev` on macOS if GUI execution is available.

Expected:

- window is visible and nonblank.
- window stays on top.
- hide/minimize works.
- edge-hide works.
- hover reveal works.
- existing Raycast menu-bar still runs independently.

If GUI execution is blocked by sandbox, record the exact command for user-side manual verification.

## Task 5: Packaging, Docs, Verification, And Task Completion

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`
- Modify: `.gitignore`
- Create: `docs/companion.md`
- Modify: `openspec/changes/wsl2-monitoring/tasks.md`

**Interfaces:**
- Produces script: `companion:package`
- Produces docs for Windows + WSL2 prerequisites, macOS compatibility, development, packaging, and manual verification.

- [x] **Step 1: Add packaging**

Run:

```bash
npm install --save-dev electron-builder
```

Add:

```json
{
  "companion:package": "npm run companion:build && electron-builder --config electron-builder.yml"
}
```

Create `electron-builder.yml` with app id, product name, `dist-companion` files, icon asset, Windows portable target, and macOS dir target.

Update `.gitignore`:

```gitignore
dist-companion
release
```

- [x] **Step 2: Add docs**

Create `docs/companion.md` covering:

- macOS Raycast behavior remains unchanged.
- macOS floating companion is optional and separate.
- Windows companion reads WSL via `\\wsl$`.
- WSL hooks write `~/.codepulse/events`.
- development command: `npm run companion:dev`.
- package command: `npm run companion:package`.
- manual checks for always-on-top, hide/minimize, edge-hide, hover reveal, path copy, WSL unavailable state.

- [x] **Step 3: Full verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run companion:build
openspec validate wsl2-monitoring
```

Expected: all commands PASS.

Run `npm run companion:package` on target platforms when available. If current platform cannot produce both Windows and macOS artifacts, record that target-platform packaging still needs target-platform execution.

- [ ] **Step 4: Mark OpenSpec tasks complete after implementation**

Only after implementation and verification pass, update `openspec/changes/wsl2-monitoring/tasks.md` checkboxes from `[ ]` to `[x]`.

Run: `openspec validate wsl2-monitoring`

Expected: PASS.

## Self-Review

- Spec coverage: floating companion is Tasks 3 and 4; WSL2 scanning is Tasks 1 and 3; WSL-local events are Tasks 1 and 2; path copy is Task 3; macOS compatibility is Tasks 1, 2, 4, and 5; packaging is Task 5.
- Placeholder scan: no unfinished marker words or incomplete command placeholders are intentionally present.
- Type consistency: `ScanRoots`, `StateBuildConfig`, `HookInstallOptions`, `WslContext`, floating view model, geometry helpers, and state source names are defined before downstream tasks consume them.
- Scope check: Windows Terminal focus, multi-distro selection, automatic updates, code signing, startup registration, and Raycast-managed companion lifecycle remain out of scope.
