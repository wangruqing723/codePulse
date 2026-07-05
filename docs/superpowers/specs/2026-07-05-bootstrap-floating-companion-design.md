---
comet_change: bootstrap-floating-companion
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-05-bootstrap-floating-companion
status: final
---

# Bootstrap Floating Companion Design

## Context

Raycast extension commands can provide Raycast-hosted views and menu-bar entries, but they do not provide an API for an arbitrary always-on-top desktop window. CodePulse therefore keeps the real Floating Companion as an Electron companion process. The current gap is distribution: a Raycast organization Store install does not place `CodePulse Companion.app` or `CodePulse Companion.exe` on the user's machine.

The first attempted launch helper searched for already-installed app paths. That is not enough because users have not manually installed a companion artifact. This design replaces that draft with a bootstrap flow: CodePulse Center installs a verified companion artifact into Raycast's support directory and then launches it.

The user has decided to make the current GitHub repository public later and to use public GitHub Release URLs for companion artifacts. The first bootstrap implementation should therefore avoid private GitHub token handling and instead fail clearly while the public release artifact is unavailable.

## Goals

- Add `Install / Start Floating Companion` to CodePulse Center.
- Install companion artifacts under `environment.supportPath/companion/<version>/<platform-arch>/`.
- Use a public GitHub Release manifest from the current repository after the repository is made public.
- Download platform-specific companion zip artifacts through public URLs.
- Verify every downloaded zip with SHA-256 before extraction.
- Launch only a locally installed, verified companion artifact.
- Preserve the existing force-exit recovery action.
- Keep `npm run companion:dev` as a maintainer-only development path.

## Non-Goals

- Do not implement private GitHub release token support in the first version.
- Do not make Raycast run `npm run companion:dev` for Store users.
- Do not install into `/Applications` or `%LOCALAPPDATA%` in the first version.
- Do not complete code signing, notarization, DMG/MSI installers, or auto-update daemons in this change.
- Do not promise macOS can reliably build Windows artifacts; Windows packaging should be target-platform or CI based.

## Architecture

The implementation should replace the current `launch-control` draft with a bootstrap-oriented helper. The helper has four layers:

1. **Manifest resolution**: resolve the release manifest URL. The default should be derived from the current repository and package version, with an optional Raycast preference override for release tag or manifest URL.
2. **Install lookup**: check `environment.supportPath/companion/<version>/<platform-arch>/` for an installed companion entrypoint.
3. **Download and install**: if no installed artifact exists, download the manifest and platform zip, verify SHA-256, extract into a temporary install directory, then atomically promote to the versioned install directory.
4. **Launch**: use Raycast `open(target)` on the installed entrypoint.

```text
CodePulse Center
  |
  v
bootstrapCompanion()
  |
  +-- findInstalledCompanion(supportPath, version, platformKey)
  |
  +-- download manifest from public release URL
  |
  +-- download platform zip
  |
  +-- sha256(zip) == manifest.sha256 ?
  |
  +-- extract to supportPath/companion/<version>/<platform-key>/
  |
  v
open(installedEntrypoint)
```

## Manifest Shape

The manifest should be plain JSON and small enough to inspect. A first version can use:

```json
{
  "version": "0.1.3",
  "artifacts": {
    "darwin-arm64": {
      "url": "https://github.com/wangruqing723/codePulse/releases/download/codepulse-companion-v0.1.3/CodePulse-Companion-darwin-arm64.zip",
      "sha256": "<sha256>",
      "entrypoint": "CodePulse Companion.app"
    },
    "win32-x64": {
      "url": "https://github.com/wangruqing723/codePulse/releases/download/codepulse-companion-v0.1.3/CodePulse-Companion-win32-x64.zip",
      "sha256": "<sha256>",
      "entrypoint": "CodePulse Companion.exe"
    }
  }
}
```

The bootstrap helper should treat a missing platform key as unsupported platform, not as a generic network error.

## Platform Keys And Paths

Use `${process.platform}-${process.arch}` as the platform key. The first target is `darwin-arm64`. `win32-x64` should be represented in the manifest and tests, but actual artifact production can be gated by CI availability.

Installation paths:

- Root: `environment.supportPath/companion`
- Download cache: `environment.supportPath/companion/downloads`
- Versioned install: `environment.supportPath/companion/<version>/<platform-key>`
- macOS entrypoint: `<install>/CodePulse Companion.app`
- Windows entrypoint: `<install>/CodePulse Companion.exe`

## Error Handling

The helper should return typed results instead of throwing for expected product states:

- `launched`: installed or downloaded artifact was opened.
- `release-unavailable`: manifest or platform artifact URL is unavailable.
- `unsupported-platform`: no artifact exists for the current platform key.
- `hash-mismatch`: downloaded zip SHA-256 does not match the manifest.
- `install-failed`: extraction or filesystem install failed.

Unexpected exceptions can still be converted to `install-failed` at the CodePulse Center boundary. UI toasts should be specific enough for a user to understand whether they need to publish a release, wait for platform support, or retry after a network failure.

## Release Artifact Path

This change should include the shape of the public release artifact path. It may include a local packaging script for macOS arm64 zip and SHA-256 generation. A full GitHub Actions release pipeline can be included if it remains small; otherwise it should be documented and handled in a follow-up change.

Windows packaging should not be treated as complete unless a Windows runner or target-platform validation produces the artifact.

## Testing Strategy

Use TDD during build. Focused tests should cover:

- Existing installed companion launches without download.
- Missing public release manifest reports `release-unavailable`.
- Missing platform key reports `unsupported-platform`.
- Hash mismatch deletes or ignores the downloaded zip and does not launch.
- Successful download verifies SHA-256, extracts, and launches.
- CodePulse Center shows success, release unavailable, unsupported platform, hash mismatch, and install failure toasts.

Final verification should run:

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run companion:build`

## Risks

- Public release artifacts are executable downloads. Mitigation: current repository release source, SHA-256 in manifest, no launch before verification.
- The repository is currently private. Mitigation: first version reports release unavailable until the repository and release assets are public.
- Unsigned macOS companion may be blocked by Gatekeeper. Mitigation: document the limitation and keep signing/notarization as a separate follow-up.
- Windows artifact generation may not be reliable on macOS. Mitigation: design for `win32-x64`, but validate artifact generation on Windows runner or target platform.
