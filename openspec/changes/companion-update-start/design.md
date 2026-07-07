## Context

CodePulse already stores companion installs under Raycast `environment.supportPath` by package version and platform. When a current-version artifact exists, the bootstrap opens it; when it does not, it downloads the release manifest and platform zip, verifies SHA-256, extracts, and launches the installed artifact.

The implementation behavior is mostly present, but the Raycast action and progress copy still read as a one-time install/start path. This makes upgrades feel manual and obscures the fact that the user should simply click the same action after a Store update.

## Goals / Non-Goals

**Goals:**

- Make the CodePulse Center action read as one install/update/start entry point.
- Make progress copy explicitly mention current-version checks and updates.
- Bump the extension version to `0.1.6` before the next organization Store publish.
- Keep old companion installs intact if the current-version download or install fails.

**Non-Goals:**

- No background silent update process.
- No new preference or release URL contract.
- No cleanup of old version directories.
- No companion artifact publishing automation in this change.

## Decisions

- Reuse the existing versioned install contract instead of adding a separate update registry. The package version already defines the desired companion version.
- Keep update user-initiated from CodePulse Center. This avoids background network behavior in Raycast command lifecycles while removing manual zip handling.
- Limit implementation to action title, progress text, version metadata, and tests. The bootstrap download/extract logic remains unchanged because it already falls through to download when the current version is missing.

## Risks / Trade-offs

- Current-version companion release assets must exist before users click update. Mitigation: release-unavailable toast remains explicit and preserves older installs.
- Users may still need to click the action once after the Raycast extension updates. Mitigation: action copy now says Update, making the required action visible and non-manual.
