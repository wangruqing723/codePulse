---
comet_change: polish-floating-companion-ui
role: technical-design
canonical_spec: openspec
---

# Polish Floating Companion UI Design

## Context

The floating companion header polish reduced visual weight by replacing text buttons with icon buttons. That exposed a renderer event delegation bug: clicking the icon `span` inside a button does not trigger the button action because the current handler only reads `event.target.dataset.action`.

The companion also runs outside the Raycast command process. Raycast reads `activeWindowMinutes` and `monitorProjects` through `getPreferenceValues()`, but the companion currently only reads environment variables or defaults, so it keeps using the 5 minute fallback even when the user configured a different Raycast monitoring window.

## Design

### Icon Button Interaction

Keep the current `data-action` contract on the button elements. Update the renderer click handler to resolve the actionable element with `target.closest("[data-action]")` instead of reading only the immediate event target. This preserves the existing IPC action names and supports clicks on either the button background or any icon element inside it.

### Preference Snapshot Sync

Add a small shared preference snapshot module under `src/lib`. It will expose:

- a shared home-based snapshot root, `~/.codepulse`
- a deterministic snapshot file path under that shared root
- `saveCompanionPreferencesSnapshot(root, preferences)` for Raycast commands
- `loadCompanionPreferencesSnapshot(root)` for the Electron companion
- `resolveCompanionPreferences(root, fallback)` to merge snapshot values over environment/default fallback values

Raycast commands write the snapshot after reading `getPreferenceValues()`. The companion reads the snapshot from the same `~/.codepulse` root before building state. When the snapshot is missing or invalid, the companion continues with environment variables and defaults.

This keeps the source of truth in Raycast preferences without coupling Electron code to Raycast APIs or private Raycast storage.

## Data Flow

1. Raycast command calls `getPreferenceValues<Preferences>()`.
2. Raycast command writes `{ activeWindowMinutes, monitorProjects }` to a JSON snapshot in `~/.codepulse`.
3. Companion refresh resolves fallback preferences from environment/defaults.
4. Companion attempts to load the snapshot from `app.getPath("userData")` compatible state root.
5. `buildStateFromConfig` receives the resolved preferences and applies the configured active window and monitor project prefixes.

## Edge Cases

- Snapshot missing: companion uses environment/default fallback.
- Snapshot malformed: companion ignores it and uses fallback.
- Empty optional fields: fallback stays available for fields not present in the snapshot.
- Click target is a nested icon span: renderer still resolves the parent button action.

## Tests

- Renderer unit test dispatches click events on icon spans and expects the corresponding bridge window action.
- Preference snapshot unit tests cover save/load, invalid snapshot fallback, snapshot-over-environment precedence, and default fallback.
- Companion main test verifies refresh uses resolved preferences instead of the hard-coded default.
- Existing full suite, lint, Raycast build, and companion build remain the final validation gates.
