# TASKS — 修复幽灵「运行中」会话

> 需求目录：`specs/2026-07-18-session-end-ghost-running/`
> 设计见同目录 `DESIGN.md`。格式：`[ ] 任务名 | 优先级 | 估时 | 依赖`

## 前置校验（Codex 实现前必做，非代码任务）

[ ] 用真实 SessionEnd payload 确认字段规格 | P0 | 15m | 无
    - 触发一次 Claude Code `SessionEnd`，抓取 stdin JSON，确认存在且拼写为 snake_case：
      `hook_event_name` / `session_id` / `transcript_path` / `cwd`（可能有 `reason`）。
    - 若某字段缺失或拼写不同，按实际字段调整 hook 脚本解析，并记入 KNOWN_ISSUES.md。

## P0 — 主修复（Claude 侧 SessionEnd）

[ ] T1 安装 SessionEnd hook | P0 | 20m | 前置校验
    - 文件：`src/lib/hooks.ts` `installClaudeHooks`（约 L812）。
    - 在现有 Notification / Stop / UserPromptSubmit 之外，新增 `upsertCodePulseClaudeHook(settings, "SessionEnd", buildClaudeHookCommand(scriptPath, "SessionEnd"))`。
    - 约束：与现有三个 hook 完全同构，marker 一致；不改 buildClaudeHookCommand 签名。
    - 验收：装 hook 后 settings.json 的 `hooks.SessionEnd` 含 marker。

[ ] T2 mapEvent 显式映射 sessionend → done | P0 | 20m | 前置校验
    - 文件：`src/lib/hooks.ts` `hookScriptContent` 内嵌脚本的 `mapEvent`（约 L660）。
    - 在默认 `return "running"` 之前，显式加：`if (eventName === "sessionend" || eventName.includes("session-end") || eventName.includes("session_end")) return "done";`
    - 理由：现状 SessionEnd 会落默认分支被误判 running（bug 放大点）。
    - 输入/输出：输入小写事件名字符串，输出 `"done"`。
    - 验收：`--event SessionEnd` 与 stdin `hook_event_name:"SessionEnd"` 均得 `kind:"done"`。

[ ] T3 卸载覆盖 SessionEnd | P0 | 10m | T1
    - 文件：`src/lib/hooks.ts` `uninstallHooks` / `removeCodePulseClaudeHooks`（约 L840、L1734）。
    - 确认卸载按 marker 全量清理，SessionEnd 一并移除；若非全量则补齐。
    - 验收：装后卸，settings.json 无任何 CodePulse marker（含 SessionEnd）。

## P1 — 兜底修复（被动扫描）

[ ] T4 收紧 inferClaudeStatus 的 user 分支 | P1 | 20m | 无
    - 文件：`src/lib/scanners.ts` `inferClaudeStatus`（约 L213）。
    - 现状：`if (type === "user") return "running";` 无 age 约束。
    - 改为：仅当 `ageMs <= RUNNING_MTIME_WINDOW_MS`（30s）才 running，否则继续下落到
      末尾 `ageMs <= RUNNING_MTIME_WINDOW_MS ? "running" : "done"` 逻辑（即超窗判 done）。
    - 注意：不得影响 `isClaudeInterruptedByUser`（已 return done）与 tool_use 分支。
    - 验收：最后一条为 user、age>30s 的会话判 done；age≤30s 仍 running。

## P2 — 测试

[ ] T5 hooks 测试 | P0 | 25m | T1,T2,T3
    - 文件：`src/lib/hooks.test.ts`。
    - 用例：①installClaudeHooks 后 SessionEnd 含 marker；②mapEvent(SessionEnd)=done
      （若 mapEvent 未导出，通过写脚本+执行或既有测试模式覆盖，与现有测试风格一致）；
      ③卸载后 SessionEnd 被清除。

[ ] T6 scanners 测试 | P1 | 20m | T4
    - 文件：`src/lib/scanners.test.ts`。
    - 用例：最后一条 user + ageMs 分别 <30s / >30s，断言 running / done。

[ ] T7 state 合并测试（按需） | P2 | 20m | T2
    - 文件：`src/lib/state.test.ts`。
    - 用例：被动扫描给 running 的会话，收到 SessionEnd(done) hook 事件后合并结果为 done；
      覆盖「仅有 cwd、无 session_id 的 SessionEnd」按 cwd 兜底匹配。

## 收尾（Codex 完成后）

[ ] T8 npm test 全绿 + npm run lint 通过 | P0 | 10m | 全部
    - 不自动 commit；产出交 Claude 评审 → 用户拍板提交。

## 分支约定

- 当前在 `dev`（非主分支），按项目规范直接在 `dev` 提交，无需新建 worktree。
- 默认不自动提交。
