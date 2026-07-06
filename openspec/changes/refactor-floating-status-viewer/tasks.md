## 1. View Model And State Semantics

- [x] 1.1 Add focused view-model tests for status summary ordering, four-state card display, context text, duration text, and idle exclusion.
- [x] 1.2 Update `src/companion/view-model.ts` to expose UI-ready summary/card fields and Windows UNC-first single copy action.

## 2. Window Actions

- [ ] 2.1 Add focused renderer/main/preload tests for `pin`, `minimize`, and `close` actions and for removal of visible `force-exit`/`hide` controls.
- [ ] 2.2 Update `src/companion/preload.ts` and `src/companion/main.ts` so the floating window supports pin toggle, minimize, and close while retaining non-UI recovery IPC where needed.

## 3. Renderer And Styling

- [ ] 3.1 Refactor `src/companion/renderer.tsx` card markup for status dot, title, path row, ghost copy action, context row, tooltip, and duration slot.
- [ ] 3.2 Refactor `src/companion/styles.css` for dark status viewer polish, four-tone state colors, running pulse animation, error border, path truncation, and stable compact controls.

## 4. Verification

- [ ] 4.1 Run focused companion unit tests covering view-model, renderer, and main window actions.
- [ ] 4.2 Run `npm run lint`, `npm run build`, and `npm run companion:build`.
- [ ] 4.3 Launch or otherwise visually inspect the companion layout and record any unverified platform-specific residual risk.
