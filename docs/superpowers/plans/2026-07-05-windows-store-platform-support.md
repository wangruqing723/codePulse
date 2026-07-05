# Windows Store Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Raycast organization Store listing show CodePulse as supporting both macOS and Windows without overstating Windows target-platform validation.

**Architecture:** This is a metadata and documentation change. The existing Windows/WSL2 companion implementation remains unchanged; Store-facing platform support is declared in `package.json`, and user-facing copy clarifies the Windows support boundary.

**Tech Stack:** Raycast extension manifest in `package.json`, Markdown documentation in `README.md` and `docs/companion.md`, validation with Raycast CLI, Vitest, and companion esbuild scripts.

## Global Constraints

- Declare Raycast platform support as `["macOS", "Windows"]`.
- Keep `owner: "code-pulse"` and `access: "private"` unchanged.
- Update extension and command descriptions so they no longer imply macOS-only support.
- Document that Windows support focuses on Raycast + WSL2-backed companion behavior and still needs Windows + WSL2 target-platform validation.
- Do not change Windows companion runtime logic unless validation reveals a manifest or copy-related failure.
- Bump `package.json` version from `0.1.1` to `0.1.2` before the next Raycast Store publish attempt.

---

## File Structure

- `package.json`: Raycast manifest source of truth for version, Store platform availability, extension description, and command descriptions.
- `README.md`: short project overview and platform support summary.
- `docs/companion.md`: companion-specific development and platform boundary documentation.

---

### Task 1: Manifest Platform Metadata

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: current Raycast manifest with `owner: "code-pulse"` and `access: "private"`.
- Produces: manifest version `0.1.2`, `platforms: ["macOS", "Windows"]`, and cross-platform descriptions for Raycast lint/build.

- [x] **Step 1: Update package manifest metadata**

Change the top of `package.json` from the current macOS-only copy to:

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "code-pulse",
  "version": "0.1.2",
  "title": "CodePulse",
  "description": "Monitor Claude Code and Codex CLI task states across macOS and Windows.",
  "icon": "codepulse-icon-v2.png",
  "author": "ruqing_wang",
  "owner": "code-pulse",
  "access": "private",
  "platforms": ["macOS", "Windows"],
  "license": "MIT"
}
```

Keep the existing `commands`, `preferences`, `scripts`, `dependencies`, and `devDependencies` blocks in place after `license`.

- [x] **Step 2: Update command descriptions**

In `package.json`, keep command names and modes unchanged, but use these descriptions:

```json
{
  "name": "codepulse",
  "title": "CodePulse",
  "description": "Show active Claude Code and Codex CLI sessions at a glance.",
  "icon": "codepulse-icon-v2.png",
  "mode": "menu-bar",
  "interval": "5s"
}
```

```json
{
  "name": "setup-hooks",
  "title": "CodePulse Center",
  "description": "Configure hooks and recover the floating companion.",
  "icon": "setup-hooks-icon-v2.png",
  "mode": "view"
}
```

- [x] **Step 3: Verify manifest values**

Run:

```bash
node - <<'NODE'
const pkg = require("./package.json");
console.log(pkg.version);
console.log(JSON.stringify(pkg.platforms));
console.log(pkg.description);
NODE
```

Expected output includes:

```text
0.1.2
["macOS","Windows"]
Monitor Claude Code and Codex CLI task states across macOS and Windows.
```

---

### Task 2: Platform Support Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/companion.md`

**Interfaces:**
- Consumes: manifest-level platform support from Task 1.
- Produces: user-facing documentation that explains macOS support, Windows support, and the Windows + WSL2 validation boundary.

- [x] **Step 1: Update README project summary**

Change the first paragraph of `README.md` to:

```markdown
CodePulse is a Raycast extension for monitoring Claude Code and Codex CLI sessions across macOS and Windows.
```

- [x] **Step 2: Add README platform support section**

Add this section before `## Development`:

```markdown
## Platform support

- macOS: Raycast menu bar monitoring, local transcript scanning, hook setup, notifications, and optional floating companion recovery are supported.
- Windows: Raycast Store availability is enabled for organization users. Windows support focuses on WSL2-backed Claude Code and Codex CLI session monitoring through the floating companion and Windows/UNC path copy helpers.

Windows + WSL2 target-platform validation is still recommended before treating a release as fully production-verified on Windows.
```

- [x] **Step 3: Add companion Windows support note**

In `docs/companion.md`, add or update a `## Windows support` section with:

```markdown
## Windows support

The companion includes Windows-oriented WSL2 support. On Windows, CodePulse expects Claude Code and Codex CLI session data to live inside the default WSL2 distribution and reads it through `\\wsl$` UNC paths.

Current Windows support is intentionally scoped:

- WSL2-backed session discovery
- floating companion display
- WSL path copy
- Windows UNC path copy
- companion process recovery helpers

Out of scope for this release:

- Windows Terminal focus/open actions
- multiple WSL distribution selection
- code signing, autostart, and automatic companion updates

Run target-platform validation on Windows + WSL2 before treating a release as fully production-verified on Windows.
```

- [x] **Step 4: Inspect docs for stale macOS-only claims**

Run:

```bash
rg -n "macOS-only|only macOS|当前仅 macOS|macOS menu bar|Mac-only|Mac only" README.md docs package.json
```

Expected: no active Store-facing claim that CodePulse only supports macOS. Historical design docs may still mention older scope; do not rewrite archived history unless it appears in current user-facing docs.

---

### Task 3: Validation And Branch Sync

**Files:**
- Verify: `package.json`
- Verify: `README.md`
- Verify: `docs/companion.md`

**Interfaces:**
- Consumes: metadata and documentation changes from Tasks 1 and 2.
- Produces: verified `dev` and `main` branches ready for the user's manual Raycast publish attempt.

- [x] **Step 1: Run automated tests**

Run:

```bash
npm test
```

Expected: all existing Vitest files pass.

- [x] **Step 2: Run Raycast manifest and style validation**

Run:

```bash
npm run lint
```

Expected: Raycast package, icon, ESLint, and Prettier validation pass.

- [x] **Step 3: Run Raycast build**

Run:

```bash
npm run build
```

Expected: Raycast entry points compile and TypeScript checks pass.

- [x] **Step 4: Run companion build**

Run:

```bash
npm run companion:build
```

Expected: companion build completes without errors.

- [x] **Step 5: Commit on dev**

Run:

```bash
git add package.json README.md docs/companion.md docs/superpowers/plans/2026-07-05-windows-store-platform-support.md
git commit -m "chore: enable windows store platform support"
```

- [x] **Step 6: Push dev, merge to main, push main**

Run:

```bash
git push origin dev
git checkout main
git merge dev
git push origin main
```

Expected: `origin/dev` and `origin/main` point to the same final commit.

- [x] **Step 7: Publish handoff**

Tell the user to publish manually from the repository root:

```bash
npx ray publish
```

Expected success output must include:

```text
info  - uploaded extension
info  - created new version
ready - published extension to your private organization code-pulse store
```
