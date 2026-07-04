# Task 1 Companion Recovery Report

## Scope

- `src/companion/process-control.ts`
- `src/companion/process-control.test.ts`
- `src/companion/kill.ts`
- `src/companion/main.ts`
- `src/companion/main.test.ts`
- `scripts/build-companion.mjs`
- `package.json`

## RED

Command:

```bash
npm test -- src/companion/process-control.test.ts src/companion/main.test.ts
```

Result:

- `src/companion/process-control.test.ts` failed because `./process-control` did not exist.
- `src/companion/main.test.ts` failed because startup did not register the shared companion process before window creation.

## GREEN

Implemented:

- Shared companion process record persistence under `~/.codepulse/companion/process.json`
- Targeted process-tree resolution for macOS/Linux via `ps -axo pid=,ppid=,command=`
- Windows `taskkill /PID <pid> /T /F` handling
- Fallback process matching constrained by recorded `execPath` and `argv`
- `npm run companion:kill` CLI entrypoint and companion build output for `dist-companion/kill.cjs`
- Startup registration in `src/companion/main.ts`

Verification:

```bash
npm test -- src/companion/process-control.test.ts src/companion/main.test.ts
npm run companion:build
```

Observed:

- `9` tests passed across the targeted suites.
- `npm run companion:build` completed successfully.

## Notes

- Protected user documentation changes were left untouched:
  - `.superpowers/sdd/task-5-report.md`
  - `docs/superpowers/specs/2026-07-03-wsl2-monitoring-design.md`
  - `openspec/changes/wsl2-monitoring/specs/wsl2-monitoring/spec.md`

## Task 1 Review Fix

RED:

```bash
npm test -- src/companion/process-control.test.ts
```

Observed:

- `clears a stale record when the recorded companion process is gone` failed because `readCompanionProcessRecord()` returned the stored JSON record without checking the process table.
- `does not kill unrelated children under the same launcher` failed because Unix resolution rooted at `launcherPid` and included unrelated children under that launcher.

GREEN:

- `readCompanionProcessRecord()` now validates the stored record against live process state and clears the record when no matching companion process remains.
- Unix process resolution only roots collection at processes whose command matches the stored `execPath` / `argv` markers; `launcherPid` is not used as a broad root unless its own command matches the record.
- `.superpowers/sdd/task-1-companion-recovery-report.md` was removed from git tracking with content kept in the working tree.

Verification:

```bash
npm test -- src/companion/process-control.test.ts src/companion/main.test.ts
npm run companion:build
```

Observed:

- `11` tests passed across the targeted suites.
- `npm run companion:build` completed successfully.
