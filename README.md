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
