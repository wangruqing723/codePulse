# CodePulse

CodePulse is a Raycast extension for monitoring Claude Code and Codex CLI sessions across macOS and Windows.

## MVP scope

- Passive jsonl scanning for `~/.claude/projects/**/*.jsonl`
- Passive jsonl scanning for `~/.codex/sessions/**/*.jsonl`
- Menu bar grouping for running, waiting, done, idle, and error sessions
- Optional hook/notify setup for precise "waiting for me" transitions
- iTerm2 focus by cwd with fallback to AppleScript and cwd copy

## Platform support

- macOS: Raycast menu bar monitoring, local transcript scanning, hook setup, notifications, and optional floating companion recovery are supported.
- Windows: Raycast Store availability is enabled for organization users. Windows support focuses on WSL2-backed Claude Code and Codex CLI session monitoring through the floating companion and Windows/UNC path copy helpers.

Windows + WSL2 target-platform validation is still recommended before treating a release as fully production-verified on Windows.

## Development

```bash
nvm use
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` before packaging.

## Floating Companion Bootstrap

`CodePulse Center` includes `Install / Start Floating Companion`. The action first checks Raycast's support directory for a verified companion install. If it is missing, it downloads `codepulse-companion-manifest.json` and the matching platform zip from the current repository's public GitHub Release, verifies SHA-256, extracts to `environment.supportPath/companion/<version>/<platform-arch>/`, and launches the installed artifact.

Bootstrap publishing assumes the repository or release assets are public before users rely on the default bare GitHub Release URLs. This version does not support private GitHub release tokens.

Maintainers publish macOS companion artifacts through GitHub Actions. Use the `Release Companion` workflow, or push a tag that matches the package version:

```bash
git tag codepulse-companion-v$(node -p "require('./package.json').version")
git push origin codepulse-companion-v$(node -p "require('./package.json').version")
```

The workflow builds the companion on GitHub's macOS runner, generates `CodePulse-Companion-darwin-arm64.zip` and `codepulse-companion-manifest.json`, creates GitHub Release tag `codepulse-companion-v<version>` when needed, and uploads both assets. Maintainers do not need to build or upload ZIP files locally.

Windows bootstrap is represented by the manifest contract, but Windows companion packaging should be generated and validated on a Windows runner or target Windows machine before publishing `win32-x64` artifacts.

Unsigned macOS companion builds may still be blocked by Gatekeeper; signing and notarization are tracked as a follow-up.
