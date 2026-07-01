# CodePulse

CodePulse is a Raycast menu bar extension for monitoring Claude Code and Codex CLI sessions.

## MVP scope

- Passive jsonl scanning for `~/.claude/projects/**/*.jsonl`
- Passive jsonl scanning for `~/.codex/sessions/**/*.jsonl`
- Menu bar grouping for running, waiting, done, idle, and error sessions
- Optional hook/notify setup for precise "waiting for me" transitions
- iTerm2 focus by cwd with fallback to AppleScript and cwd copy

## Development

```bash
nvm use
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` before packaging.
