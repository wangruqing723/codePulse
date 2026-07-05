## 1. Bootstrap Contract And Preferences

- [x] 1.1 Add Raycast preferences for optional release tag or manifest URL override.
- [x] 1.2 Define companion release manifest types, platform keys, install paths, and local installed artifact resolution.
- [x] 1.3 Replace the current launch-only helper draft with bootstrap-oriented tests for local installed artifact, release unavailable, unsupported platform, and hash mismatch.

## 2. Download, Verify, Install, Launch

- [x] 2.1 Implement public GitHub release manifest and asset download.
- [x] 2.2 Implement SHA-256 verification and safe download cleanup on mismatch.
- [x] 2.3 Implement zip extraction into `environment.supportPath/companion/<version>/<platform-arch>/`.
- [x] 2.4 Launch the installed companion artifact through Raycast `open(target)`.

## 3. CodePulse Center UX

- [x] 3.1 Rename the action to `Install / Start Floating Companion`.
- [x] 3.2 Show success, release-unavailable, unsupported-platform, network-failure, and hash-mismatch toasts.
- [x] 3.3 Preserve the existing force-exit Floating Companion action.

## 4. Release Artifact Path

- [x] 4.1 Add or document a companion release manifest format for current-repository GitHub Releases.
- [x] 4.2 Add a packaging script or GitHub Actions workflow path for macOS arm64 companion zip and SHA-256 output.
- [x] 4.3 Record Windows x64 packaging constraints and, if feasible, add a Windows runner packaging path.

## 5. Documentation And Verification

- [x] 5.1 Document that the current repository must be public before using public release URLs.
- [x] 5.2 Document current security and platform limitations, including unsigned companion behavior.
- [x] 5.3 Run focused bootstrap tests, full test suite, `npm run lint`, `npm run build`, and `npm run companion:build`.
