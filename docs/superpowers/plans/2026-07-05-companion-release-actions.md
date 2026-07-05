# Companion Release Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move companion release artifact generation and upload from local manual work to GitHub Actions.

**Architecture:** A GitHub Actions workflow runs on macOS, installs dependencies, runs the existing `npm run companion:release:mac` script, verifies the generated zip and manifest, creates the matching GitHub Release, and uploads the assets. The Raycast extension continues to download from the existing public GitHub Release URL contract.

**Tech Stack:** GitHub Actions, GitHub CLI, Node.js from `.nvmrc`, npm, electron-builder, existing companion packaging scripts.

## Global Constraints

- Do not require maintainers to build or upload companion ZIP files locally.
- Use the current repository release tag format `codepulse-companion-v<package.json version>`.
- Keep Windows artifact publishing out of scope until Windows packaging is generated and validated on a Windows runner.
- Repository visibility must be public before default bare GitHub Release URLs work for Raycast runtime downloads.

---

### Task 1: GitHub Actions companion release workflow

**Files:**

- Create: `.github/workflows/release-companion.yml`

**Interfaces:**

- Consumes: `package.json` `version`, `.nvmrc`, `npm run companion:release:mac`.
- Produces: GitHub Release assets `CodePulse-Companion-darwin-arm64.zip` and `codepulse-companion-manifest.json`.

- [x] **Step 1: Add workflow trigger**

The workflow runs on manual dispatch and on tags matching `codepulse-companion-v*`.

- [x] **Step 2: Add metadata guard**

The workflow resolves `package.json` version into `codepulse-companion-v<version>` and fails if a pushed tag does not match that value.

- [x] **Step 3: Build and verify artifacts**

The workflow runs `npm run companion:release:mac` and checks both expected release files exist.

- [x] **Step 4: Create or reuse release**

The workflow creates the GitHub Release when missing and reuses it when present.

- [x] **Step 5: Upload assets**

The workflow uploads the macOS ZIP and manifest through `gh release upload`.

### Task 2: Documentation update

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: workflow behavior from Task 1.
- Produces: maintainer-facing release instructions.

- [x] **Step 1: Replace local upload instructions**

Remove the local manual `npm run companion:release:mac` and asset upload instruction as the primary path.

- [x] **Step 2: Document public repository prerequisite**

Keep the explicit note that the repository or release assets must be public before Raycast can download the companion with default URLs.
