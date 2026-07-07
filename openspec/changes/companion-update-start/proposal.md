## Why

Users can already install a versioned Floating Companion from Raycast, but the current action copy reads like a one-time install/start flow. After the Raycast extension version changes, users need a clearer one-click update path and maintainers need the next Store publish to use a fresh package version.

## What Changes

- Rename the Raycast action to make the install/update/start behavior explicit.
- Improve companion bootstrap progress copy so users understand that missing current-version installs are updated automatically.
- Bump the Raycast extension package version from `0.1.5` to `0.1.6` for the next organization Store publish.
- Keep the existing versioned support-path install contract and SHA-256 verified download behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wsl2-monitoring`: Clarify that the CodePulse Center companion action installs, updates, or starts the current-version companion artifact without requiring manual zip downloads.

## Impact

- `package.json` and `package-lock.json` version metadata.
- Raycast `CodePulse Center` action title and progress messages.
- Existing bootstrap tests for the action label and launch toast text.
