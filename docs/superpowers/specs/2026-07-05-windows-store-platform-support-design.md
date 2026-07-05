---
topic: windows-store-platform-support
role: technical-design
status: draft
---

# Windows Store Platform Support Design

## Context

CodePulse already has Windows-oriented companion code paths for WSL2 session discovery, UNC path copy actions, and companion process control. The Raycast Store manifest and public-facing copy still read as macOS-only: the extension description mentions the macOS menu bar, and the manifest does not explicitly declare Windows support through the Raycast `platforms` field.

The goal is to make the organization Store listing reflect the intended cross-platform support without overstating Windows production validation.

## Scope

This change updates Store-facing metadata and user-facing documentation only:

- Declare Raycast platform support as `["macOS", "Windows"]`.
- Update extension and command descriptions so they no longer imply macOS-only support.
- Document the Windows support boundary: Windows support is focused on Raycast + WSL2-backed CodePulse companion behavior, with Windows + WSL2 manual validation still recommended.
- Keep the existing Windows companion implementation unchanged unless validation catches a manifest or copy-related failure.

Out of scope:

- Windows Terminal focus/open actions.
- Multiple WSL distribution selection.
- Code signing, autostart, or automatic companion updates.
- Claiming full Windows target-platform manual validation from this macOS development environment.

## Design

### Manifest

Add the Raycast manifest `platforms` field:

```json
"platforms": ["macOS", "Windows"]
```

Keep `owner: "code-pulse"` and `access: "private"` unchanged so publishing still targets the organization private Store. Update the top-level description to describe CodePulse as a cross-platform Raycast extension for Claude Code and Codex CLI session monitoring.

Command descriptions should stay short and factual. The menu-bar command can describe session monitoring without saying macOS. The setup command can remain a configuration and companion recovery center.

### Documentation

Update `README.md` with a compact platform support section:

- macOS: Raycast menu bar and local transcript scanning remain supported.
- Windows: Raycast Store availability is enabled; WSL2-backed companion/session support exists, with target-platform validation recommended.

Update `docs/companion.md` if needed with a clear Windows support note that points users toward WSL2 prerequisites and the existing companion development/package commands.

### Versioning And Release

Follow the project publishing convention: every Raycast Store publish should bump `package.json` version first. Because `0.1.1` was already used for the last attempted publish cycle, this change should bump to `0.1.2` before the next publish attempt.

## Validation

Run:

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run companion:build`

Record any Windows-specific manual verification gap in the final notes rather than hiding it.

## Risks

- Store listing may imply Windows users can use every macOS flow. Mitigation: update copy and docs to distinguish Raycast Store availability from full Windows companion validation.
- Raycast may enforce manifest fields more strictly for Windows support. Mitigation: rely on `npm run lint` and `npm run build`, which validate the manifest before publishing.
