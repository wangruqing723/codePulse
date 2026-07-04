---
change: wsl2-monitoring
design-doc: docs/superpowers/specs/2026-07-03-wsl2-monitoring-design.md
base-ref: d754b469758cc4e95b05d0604dfe9d89d5ae7939
---

# Companion Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared recovery path that can kill a stuck CodePulse floating companion from CLI, Raycast `CodePulse Center`, and the companion window itself.

**Architecture:** Introduce a shared process-control module under `src/companion` that stores one companion process record in a home-scoped control directory, resolves the recorded process tree, and performs a platform-specific recovery kill. Electron main registers itself on startup, the CLI gets a thin built entrypoint, and Raycast / renderer only trigger the shared control path through direct imports or IPC.

**Tech Stack:** TypeScript, Vitest, Electron IPC, Node `fs/promises`, Node `os`, Node `path`, Node `process`, Node `child_process`, Raycast API.

## Global Constraints

- OpenSpec canonical change: `openspec/changes/wsl2-monitoring`.
- Plan scope: companion recovery only; do not fold task `2.6` or `2.7` into this work.
- Recovery must target only the CodePulse companion process tree and its Electron helpers.
- Keep Raycast command slug `setup-hooks` unchanged.
- Raycast is allowed to expose a recovery action, but it must not become the normal start/stop manager for companion.
- CLI, Raycast, and companion window must reuse the same kill logic instead of duplicating process cleanup rules.
- macOS validation is required in this session; Windows + WSL2 validation can remain pending.

---

## File Structure

- `src/companion/process-control.ts`: Shared control-root path, process record persistence, platform-specific recovery kill, and stale-record cleanup.
- `src/companion/process-control.test.ts`: Pure and mocked tests for record persistence, stale cleanup, selective matching, and platform kill behavior.
- `src/companion/kill.ts`: Thin Node CLI entrypoint that calls the shared recovery module and prints a short summary.
- `src/companion/main.ts`: Register current companion process on startup, expose recovery IPC, and clear the process record on normal exit.
- `src/companion/main.test.ts`: Startup ordering and new IPC / registration coverage.
- `src/companion/preload.ts`: Bridge recovery action from renderer to main.
- `src/companion/renderer.tsx`: Add the in-window recovery button and keep hover behavior stable.
- `src/companion/renderer.test.ts`: Cover the new recovery action wiring.
- `src/setup-hooks.tsx`: Rename the view to `CodePulse Center` and add a recovery action.
- `src/codepulse.tsx`: Update menu-bar copy so the entry reads as CodePulse Center while preserving the same deeplink slug.
- `scripts/build-companion.mjs`: Build the new CLI entrypoint alongside `main.cjs` and `preload.cjs`.
- `package.json`: Add `companion:kill` and rename the Raycast command display text.

### Task 1: Shared Process Control And CLI Recovery

**Files:**
- Create: `src/companion/process-control.ts`
- Create: `src/companion/process-control.test.ts`
- Create: `src/companion/kill.ts`
- Modify: `src/companion/main.ts`
- Modify: `src/companion/main.test.ts`
- Modify: `scripts/build-companion.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `type CompanionProcessMode = "dev" | "packaged"`
- Produces: `interface CompanionProcessRecord { pid: number; launcherPid?: number; startedAt: string; platform: NodeJS.Platform; mode: CompanionProcessMode; execPath: string; argv: string[] }`
- Produces: `readCompanionProcessRecord(): Promise<CompanionProcessRecord | undefined>`
- Produces: `registerCompanionProcess(record: CompanionProcessRecord): Promise<void>`
- Produces: `clearCompanionProcessRecord(): Promise<void>`
- Produces: `killCompanionProcess(): Promise<{ status: "killed" | "not-found"; matchedPids: number[] }>`
- Produces: `runCompanionKillCli(stdout?: Pick<Console, "log">, stderr?: Pick<Console, "error">): Promise<number>`

- [ ] **Step 1: Write the failing shared-control tests**

Create `src/companion/process-control.test.ts` with coverage for:

```ts
it("round-trips the companion record under the shared control root", async () => {
  await registerCompanionProcess({
    pid: 21707,
    launcherPid: 21706,
    startedAt: "2026-07-04T03:00:00.000Z",
    platform: "darwin",
    mode: "dev",
    execPath: "/Applications/Electron.app/Contents/MacOS/Electron",
    argv: ["dist-companion/main.cjs"],
  });

  await expect(readCompanionProcessRecord()).resolves.toMatchObject({
    pid: 21707,
    launcherPid: 21706,
    mode: "dev",
  });
});

it("kills the recorded companion tree without touching unrelated Electron processes", async () => {
  // fake ps output contains the recorded pid tree and an unrelated Electron app
  await expect(killCompanionProcess()).resolves.toEqual({
    status: "killed",
    matchedPids: [21706, 21707, 21708, 21709, 21710],
  });
});
```

Run:

```bash
npm test -- src/companion/process-control.test.ts src/companion/main.test.ts
```

Expected: FAIL because the process-control module and new startup wiring do not exist yet.

- [ ] **Step 2: Implement the shared process-control module**

Create `src/companion/process-control.ts` with a home-scoped control root and injectable OS adapters:

```ts
export interface ProcessControlDeps {
  platform: NodeJS.Platform;
  homedir(): string;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  rm: typeof rm;
  execFile(file: string, args: string[]): Promise<{ stdout: string; stderr?: string }>;
  kill(pid: number, signal?: NodeJS.Signals | number): void;
}

export function companionControlRoot(homedirPath = homedir()): string {
  return path.join(homedirPath, ".codepulse", "companion");
}
```

Implement:

- record persistence in `~/.codepulse/companion/process.json`
- stale-record cleanup when the recorded pid is gone
- macOS / Linux process-tree resolution through `ps -axo pid=,ppid=,command=`
- Windows tree kill through `taskkill /PID <pid> /T /F`
- fallback matching by recorded `execPath` and `argv` marker when the pid record is stale

Run:

```bash
npm test -- src/companion/process-control.test.ts
```

Expected: PASS.

- [ ] **Step 3: Register the running companion and add the CLI entrypoint**

Modify `src/companion/main.ts` so startup writes:

```ts
await registerCompanionProcess({
  pid: process.pid,
  launcherPid: process.ppid,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  mode: app.isPackaged ? "packaged" : "dev",
  execPath: process.execPath,
  argv: process.argv.slice(1),
});
```

Create `src/companion/kill.ts`:

```ts
import { runCompanionKillCli } from "./process-control";

void runCompanionKillCli().then((code) => {
  process.exitCode = code;
});
```

Update `scripts/build-companion.mjs` to emit `dist-companion/kill.cjs`, and add in `package.json`:

```json
"companion:kill": "npm run companion:build && node dist-companion/kill.cjs"
```

Run:

```bash
npm test -- src/companion/process-control.test.ts src/companion/main.test.ts
npm run companion:build
```

Expected: PASS.

### Task 2: CodePulse Center And In-Window Recovery

**Files:**
- Modify: `src/setup-hooks.tsx`
- Modify: `src/codepulse.tsx`
- Modify: `src/companion/preload.ts`
- Modify: `src/companion/renderer.tsx`
- Modify: `src/companion/renderer.test.ts`
- Modify: `src/companion/main.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CompanionBridge.forceExitCompanion(): void`
- Produces: IPC channel `companion:force-exit`
- Keeps: Raycast deeplink `raycast://extensions/code-pulse/code-pulse/setup-hooks`

- [ ] **Step 1: Write the failing UI wiring tests**

Extend `src/companion/renderer.test.ts` with:

```ts
expect(html).toContain('data-action="force-exit"');

hover.onWindowAction?.("force-exit");
expect(requestWindowAction.mock.calls).toEqual([["force-exit"]]);
```

Run:

```bash
npm test -- src/companion/renderer.test.ts
```

Expected: FAIL because the renderer does not expose a recovery action yet.

- [ ] **Step 2: Add companion recovery IPC and renderer action**

Update `src/companion/preload.ts` and `src/companion/main.ts` so the renderer can send a fire-and-forget recovery request:

```ts
type WindowAction =
  | "hide"
  | "hover-enter"
  | "hover-leave"
  | "minimize"
  | "force-exit";
```

Main process behavior:

- ignore `force-exit` inside the hover controller logic
- on `companion:force-exit`, call `killCompanionProcess()`
- keep `hide` / `hover-enter` / `hover-leave` / `minimize` behavior unchanged

Update the header actions in `src/companion/renderer.tsx` to include a `强制退出` button.

Run:

```bash
npm test -- src/companion/renderer.test.ts src/companion/main.test.ts
```

Expected: PASS.

- [ ] **Step 3: Rename the Raycast surface and add the recovery action**

Modify `package.json` and `src/codepulse.tsx` so the command still uses slug `setup-hooks`, but the visible labels read `CodePulse Center`. Update `src/setup-hooks.tsx` so:

- `navigationTitle="CodePulse Center"`
- the top `Floating companion` item becomes a recovery/status item
- its action panel includes a destructive action that calls `killCompanionProcess()` and then refreshes status
- hook install / uninstall items remain unchanged

Run:

```bash
npm run lint
npm test -- src/companion/renderer.test.ts src/companion/main.test.ts src/companion/process-control.test.ts
```

Expected: PASS.

- [ ] **Step 4: Verify the recovery paths on macOS**

Run:

```bash
npm run companion:build
npm run companion:kill
```

Manual verification:

- start the floating companion in dev mode
- confirm `CodePulse Center` can close the window and clear the stale record
- confirm the in-window `强制退出` action closes the current companion instance
- confirm the `setup-hooks` deeplink still opens the renamed page

Expected: CLI kill works, Raycast recovery works, companion self-recovery works, and no unrelated Electron app is terminated.
