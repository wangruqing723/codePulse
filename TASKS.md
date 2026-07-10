# Codex 导入冲突修复与 0.1.9 发布任务

[x] T1 保留并复核现有 Hook 脚本 agent 修正与状态归一两层防御 | P0 | 20 分钟 | 无
[x] T2 在 `src/lib/hooks.ts` 增加 Codex 导入健康状态、严格检测器和可注入 `codexHooksPath` | P0 | 40 分钟 | T1
[x] T3 实现精确 leaf 删除、容器字段保留、带 token 的可恢复修复锁、唯一备份、提交前双校验和原子替换修复 API | P0 | 80 分钟 | T2
[x] T4 在 `src/setup-hooks.tsx` 增加持久健康行、确认修复 action、Toast 与刷新 | P0 | 40 分钟 | T3
[x] T5 在 `src/codepulse.tsx` 增加仅冲突时显示的菜单栏告警并跳转 CodePulse Center | P1 | 25 分钟 | T2
[x] T6 扩充 `src/lib/hooks.test.ts`，覆盖检测精度、matcher/未知字段保留、备份碰撞、活动/残留锁与 token 释放、幂等、损坏 JSON、symlink 和并发变化 | P0 | 80 分钟 | T2,T3
[x] T7 扩充 `src/setup-hooks.test.ts` 及必要纯 helper 测试，覆盖确认、Toast、独立刷新和菜单告警条件 | P1 | 35 分钟 | T4,T5
[x] T8 使用 Node 22.22.2 运行 test、lint、Raycast build、Companion build 与 `git diff --check` | P0 | 30 分钟 | T1-T7
[x] T9 进行代码评审，修复发现的问题并再次执行受影响验证 | P0 | 30 分钟 | T8
[x] T9A 标记由 Claude Code 委托的真实 Codex 会话，并保持全局状态与摘要顺序一致 | P1 | 35 分钟 | T9
[ ] T10 提交功能修复，升级版本到 0.1.9，修正旧版偏好文案并提交版本变更 | P0 | 20 分钟 | T9,T9A
[ ] T11 推送 `dev`，同步并推送 `main`，确认本地与远程分支一致 | P0 | 20 分钟 | T10
[ ] T12 本地打包 Companion 0.1.9，核验 manifest、ZIP SHA-256 与 App bundle 版本 | P0 | 30 分钟 | T11
[ ] T13 创建并推送 `codepulse-companion-v0.1.9`，等待 workflow 成功并核验 Release 两项资产 | P0 | 40 分钟 | T12
[ ] T14 发布 Raycast 扩展到 private `code-pulse` Store，并核验 Store 版本为 0.1.9 | P0 | 30 分钟 | T13
[ ] T15 最终核验 Git 状态、远程 Release、Store 和 `dev...main = 0 0`，汇总证据 | P0 | 20 分钟 | T14

## 验收标准

- Codex App 再次导入 Claude Code 配置后，CodePulse 在一次刷新周期内报告冲突。
- 未修复时，两层运行时防御仍不会把 Codex 会话显示成额外的 Claude Code 会话。
- 用户确认修复后，只删除 `codepulse-hook claude` 冲突 leaf，其他导入内容原样保留。
- 每次实际修复都有唯一且可回滚的备份；并行 CodePulse 修复会被可恢复独占锁串行化，崩溃残留锁不会永久阻塞；无冲突、无效 JSON 或检测到并发变化时不破坏原文件。
- symlink 形式的 `hooks.json` 不会被自动替换；CodePulse 会提示目标路径供用户直接处理。
- 真正由 Claude Code 委托的 Codex 会话显示为 Codex 委托来源，不会计入伪 Claude Code 会话。
- 全量验证通过，GitHub Release 含 `CodePulse-Companion-darwin-arm64.zip` 与 `codepulse-companion-manifest.json`。
- Raycast private `code-pulse` Store 发布 0.1.9，`dev` 与 `main` 本地及远程一致。
