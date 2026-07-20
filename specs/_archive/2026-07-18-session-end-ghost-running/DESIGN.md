# DESIGN — 修复「会话已退出仍显示运行中」的幽灵会话

## 1. 问题陈述

用户退出 Claude Code 会话（关终端 / `Ctrl+C` 中断回合后退出 / 直接杀进程）后，
CodePulse 的**菜单栏与悬浮窗仍显示 1 个「运行中」会话**，最长可持续约 5 分钟，
之后才老化成「完成」，再到 `activeWindow`（默认 30 分钟）才从列表消失。

## 2. 根因分析

CodePulse 判断会话状态**完全依赖两条被动信号**，没有任何「进程是否存活」的检查：

1. **被动扫描**（`src/lib/scanners.ts` `inferClaudeStatus` L184）
   仅凭 transcript 文件 `mtime` 新旧 + 最后一条事件类型判定：
   - L213：最后一条是 `type === "user"` → 直接返回 `running`（**无 age 约束**，
     等于整个 5 分钟 `RUNNING_MTIME_WINDOW_MS*10` 窗口内都算 running）。
   - L205-211：最后一条是 `assistant` + `stop_reason === "tool_use"` 且 age≤30s → `running`。
   - L193：只有 age > 5 分钟才强制翻 `done`。

2. **hook 事件合并**（`src/lib/state.ts` `mergeHookEvents`）
   依赖 hook 脚本写入的即时事件（running/waiting/done/error）纠正被动扫描。

**关键缺口**：`installClaudeHooks`（`src/lib/hooks.ts` L812）只安装了
**Notification / Stop / UserPromptSubmit** 三个 hook，**没有安装 `SessionEnd`**。

- 当用户在一个回合进行中退出（关终端 / Ctrl+C），Claude Code **不会触发 `Stop` hook**
  （Stop 只在助手正常结束一个回合时触发）。
- 于是没有任何终态事件落地，transcript 最后一条停在 `user` 或 `assistant/tool_use`，
  被动扫描在 5 分钟 mtime 窗口内持续判 `running` → 幽灵会话。

**实盘佐证**（诊断时取得，now=01:25，activeWindow=30min）：
本机 `~/.claude/settings.json` 中 CodePulse 的 hook 全空/未安装；hook 事件目录里
最新一条是 7 月 12 日的过期 `done`；30 分钟内活跃的 transcript 全靠 mtime 判定，
其中最后一条为 `type=user` 的会话被判 running 直到超 5 分钟。

## 3. 设计目标

1. **主修复**：退出会话时能立刻写入终态事件，让菜单栏/悬浮窗秒级清除 running。
2. **兜底修复**：即使某些退出路径不触发 hook（如 `kill -9`），被动扫描也应更快
   停止误报 running，缩短幽灵窗口。
3. **不回归**：不破坏正常「运行中 → 完成」的展示，不误杀真正在跑的会话。

## 4. 方案

### 4.1 主修复 —— 新增 `SessionEnd` hook（Claude 侧）

**hook 安装**（`src/lib/hooks.ts`）
- 在 `installClaudeHooks`（L812）新增安装 `SessionEnd` 事件的 CodePulse hook，
  与现有三个 hook 并列。
- 卸载路径 `removeCodePulseClaudeHooks`（L840）是按 marker 全量清理，天然覆盖新 hook，
  无需改动；但需确认 `uninstallHooks` 走的是全量清理分支。

**事件映射**（`src/lib/hooks.ts` `hookScriptContent` 内的 `mapEvent` L660）
- 现状：`SessionEnd` 事件名会落到默认分支返回 `running`（**bug 放大点**）。
- 目标：显式识别 `sessionend` → 映射为终态。
  - **决策点 A（见 §6）**：映射成 `done` 还是新增/复用 `idle`。
    倾向 `done`（复用现有终态渲染，最小改动；语义为「会话结束」）。

**SessionEnd payload 兼容**
- hook 脚本已从 stdin JSON 解析 `session_id` / `transcript_path` / `cwd` / `hook_event_name`
  （L671-687），`SessionEnd` 复用同一路径即可，无需为它新增字段解析。
- **委托前置校验（Codex 必做）**：用真实 `SessionEnd` payload 确认
  `session_id` / `transcript_path` / `cwd` 字段确实存在且拼写为 snake_case；
  若某字段缺失，`sessionIdForHookEvent`（state.ts L265）仍能按 transcript / cwd 兜底匹配，
  但需在测试中覆盖「仅有 cwd、无 session_id」的 SessionEnd 事件。

### 4.2 兜底修复 —— 收紧被动扫描的 `user` 判定（`src/lib/scanners.ts`）

`inferClaudeStatus` L213 的 `type === "user"` 分支目前无 age 约束。
改为：`user` 事件也套用 `ageMs <= RUNNING_MTIME_WINDOW_MS`（30s）窗口才判 running，
超窗则视为 `done`。这样即使 SessionEnd 未触发（如 kill -9），幽灵 running 也从
最长 5 分钟收敛到 ~30 秒。

- **风险**：用户发出 prompt 后 Claude 长时间「思考」但不写文件的场景。
  实测 Claude Code 在处理中会持续更新 transcript（流式写入），mtime 通常 <30s，
  故收紧到 30s 窗口对真实运行影响小。**Codex 需在实现后用真实运行会话验证此点**，
  若发现误判，记入 KNOWN_ISSUES.md 交 Claude 决策（可放宽到 60~90s）。

### 4.3 Codex 侧是否对称处理？

- Codex 的退出信号走 `notify`（config.toml），与 Claude 的 hook 机制不同。
- 本次**只修 Claude 侧**（问题现象与实盘均为 Claude 会话）。Codex 侧的等价问题
  单独评估，记入 KNOWN_ISSUES.md，不在本需求范围。

## 5. 影响面

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/lib/hooks.ts` | `installClaudeHooks` 加装 SessionEnd；`mapEvent` 显式处理 sessionend | 核心 |
| `src/lib/scanners.ts` | `inferClaudeStatus` 的 user 分支加 age 约束 | 核心 |
| `src/lib/hooks.test.ts` | 覆盖 SessionEnd 安装与映射 | 测试 |
| `src/lib/scanners.test.ts` | 覆盖 user 超窗判 done | 测试 |
| `src/lib/state.test.ts`（按需） | 覆盖 SessionEnd 事件合并清除 running | 测试 |

**不改**：view-model、companion 主进程、菜单栏 UI —— 它们消费 snapshot，
上游状态正确后自然正确。

## 6. 待决策点（需 Claude/用户拍板，Codex 不擅自定）

- **决策 A**：`SessionEnd` 映射为 `done` 还是 `idle`？
  → 本设计选 **`done`**（复用终态渲染、最小改动）。若用户希望「退出即从列表消失」
  而非显示「完成」，则需引入 idle 语义，属更大改动，另开需求。
- **决策 B**：被动扫描 user 分支收紧窗口取值（30s / 60s / 90s）？
  → 本设计选 **30s**（= `RUNNING_MTIME_WINDOW_MS`），Codex 实测后可回报调整。

## 7. 验收标准

1. `installHooks` 后，`~/.claude/settings.json` 的 `hooks.SessionEnd` 含 CodePulse marker。
2. hook 脚本对 `--event SessionEnd`（及 stdin `hook_event_name: SessionEnd`）产出 `kind: "done"`。
3. 退出会话（触发 SessionEnd）后，下一次刷新周期内该会话不再是 running。
4. 被动扫描：最后一条为 `user`、mtime 超 30s 的 transcript 判为 `done` 而非 `running`。
5. `npm test` 全绿；新增用例覆盖上述行为；`npm run lint` 通过。
6. 卸载 hook 后 `SessionEnd` 一并被清除（marker 全量清理验证）。
