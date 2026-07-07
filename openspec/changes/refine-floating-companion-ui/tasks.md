## 1. View Model And Window State

- [x] 1.1 Add Floating Companion view-model fields for status summary items and current pin state.
- [x] 1.2 Propagate Electron always-on-top state from the main process into renderer updates.
- [x] 1.3 Keep status summary ordering and color tone data limited to running, completed, error, and waiting.

## 2. Header And Controls

- [x] 2.1 Render Header status summary as one-line flex items with 12px status dots and no wrapping.
- [x] 2.2 Remove the non-semantic Header drag-handle placeholder from renderer markup and CSS.
- [x] 2.3 Render pin, minimize, and close as icon buttons with hover feedback and clear pin active/inactive states.

## 3. Session Cards

- [x] 3.1 Rework each session card into a compact natural-height two-row layout.
- [x] 3.2 Preserve fixed status color mapping, running pulse animation, and error-card red border treatment.
- [x] 3.3 Keep paths dark, 12px, truncated with full-path title, and aligned with the copy icon button.
- [x] 3.4 Remove duplicate bottom context text when there is no error or waiting reason.

## 4. Copy Interaction

- [x] 4.1 Ensure window and copy button icons do not intercept pointer events from their parent buttons.
- [x] 4.2 Implement copy-path click handling with `navigator.clipboard.writeText(path)` and Electron bridge fallback.
- [x] 4.3 Add a lightweight copied-success visual animation for the icon-only copy button.

## 5. Verification

- [x] 5.1 Add or update renderer, view-model, and main-process tests for the UI and interaction changes.
- [x] 5.2 Run unit tests, lint, builds, companion build, and whitespace checks.
