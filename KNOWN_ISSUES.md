# KNOWN_ISSUES

## [2026-07-16] Node 24 升级评估（B 块结论：无需升级 Electron）

- 发现于：TASKS_NODE24.md 的 B 块（评估运行时升 Node 24）
- 问题描述：任务最初假设「companion 运行时是 Node 20/22，要升到 Node 24 得升级 Electron 大版本」。经核验，该前提不成立。
- 核验证据（来源：Electron 官方 releases API，2026-07-16，与 `@types/node: ^24.9.0` 交叉印证）：

  | Electron major | 内置 Node | 说明 |
  |---|---|---|
  | 39 | 22.22.1 | 最后一个 Node 22 系列 |
  | 40 | 24.15.0 | 首个内置 Node 24 |
  | 41 | 24.18.0 | |
  | 42 | 24.18.0 | |
  | 43（当前 `package.json` 依赖 `^43.0.0`） | 24.18.0 | |

- 结论：**项目当前依赖的 `electron@^43.0.0` 内置的就是 Node 24.18.0**，companion 运行时早已是 Node 24。B 块所担心的「要升 Electron 才能到 Node 24」不成立。
  - 注：之前本地 `electron/dist` 一度返回 node 22.19.0，是因为 Electron 二进制下载 `fetch failed` 未装全、留下的旧缓存假象，不可信。
- 关于 Raycast 扩展本体运行时：由 Raycast App 决定，仓库无法控制，不在本次可改范围。
- 建议：**无需为「升到 Node 24」做任何依赖升级**。若未来要跟进 Electron 更高大版本（性能/安全补丁），属于常规依赖维护，需单独走升级 + 重新打包 + Gatekeeper 验证流程，与「Node 24」诉求无关。
- 状态：已核验，待 Claude 决策是否保留本评估文档入库。

## [2026-07-16] CI action 运行时警告（A 块结论：已修复）

- 发现于：Release Companion workflow 的 GitHub Actions annotation
- 问题描述：`actions/checkout@v4`、`actions/setup-node@v4` 的 action 自身运行时是 Node 20，被 GitHub 强制拉到 Node 24 运行并告警弃用。此为 action 版本层面问题，与项目 Node 版本无关。
- 处理：已将两个 action 升级到 `@v7`（checkout v7.0 / setup-node v7.0.0，均已迁移到 ESM、以 Node 24 为运行时）。
- breaking change 评估：checkout v7 仅新增「阻止 fork PR 在 `pull_request_target`/`workflow_run` 下 checkout」的行为变更，本 workflow 触发器为 `push`(tag)+`workflow_dispatch`，不受影响；setup-node v7 仅新增 outputs、移除 dummy `NODE_AUTH_TOKEN`、升级缓存依赖，本 workflow 仅用 `node-version-file`+`cache: npm`，不受影响。
- 状态：已修复，待下次 tag 触发 workflow 时验证 annotation 消失。
