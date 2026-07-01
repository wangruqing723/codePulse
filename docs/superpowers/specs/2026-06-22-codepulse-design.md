# CodePulse 设计文档

> Claude Code + Codex CLI 的 macOS 菜单栏任务状态工具（Raycast 扩展）
> 日期: 2026-06-22 · 状态: 设计评审中

## 背景与动机（Context）

同时使用 Claude Code(CC) 和 Codex CLI 时，常出现一个痛点：**AI 已经停下来等你输入/授权，但你切去做别的事，不知道"轮到我了"**；或者一个长任务在后台跑，不知道它还在跑、跑了多久、是否卡住/出错。

调研（2026-06-22，交叉核验 Raycast Store + GitHub + HN/Reddit）发现：现有同类工具（ccusage、Agent Usage、ClaudeCast、Claude Meter、SessionWatcher、CCOwl 等）几乎全是**用量/成本统计**。最接近的 ClaudeCast 提供菜单栏 CC 状态+活跃会话指示，但①只 CC、不含 Codex；②偏成本+会话计数；③无"等待输入/授权"提醒。

**没有**一个工具「统一监控 CC + Codex、以任务状态（运行中/轮到我了/已完成/出错）为核心、并在状态切换时弹系统通知」。这就是 CodePulse 的差异化定位——重点打 **Codex 也覆盖** 和 **"轮到我了"实时提醒** 两个空白点。

> 已确认：ClaudeCast 不做"等待输入提醒"。CodePulse 的差异化重点可以继续锁定为 Codex 覆盖 + "轮到我了"实时提醒。

## 目标

- 菜单栏常驻，实时反映所有近期活跃的 CC / Codex 会话状态
- 五态：🟢运行中 / 🟡轮到我了 / 🔵已完成 / ⚪空闲 / 🔴出错
- 状态翻转时弹系统通知横幅 + 可选声音（尤其"轮到我了"和"已完成"）
- 长任务监控：显示每个会话已运行时长
- 多会话总览：按项目分组列出
- 点击会话项可切回对应 iTerm2 会话

## 非目标（MVP 之外）

- **详细视图 / Dashboard**（全量会话 List、搜索筛选）—— 推迟到 MVP 之后
- 用量/成本统计（已有大量工具覆盖，不重复）
- Windows / Linux 支持（当前仅 macOS）

## 形态与技术栈

- **Raycast `menu-bar command` 扩展**，TypeScript + React
- 不另起 launchd 守护进程；后台按刷新间隔（默认 5–10s）轮询
- 仅 macOS

## 架构：数据采集层（核心）

混合采集：**被动文件监听（零侵入基线，始终在跑）+ 主动推送（hooks/notify，用户启用后增强）**，统一写入扩展自己的状态文件，Raycast menu-bar 只读它渲染。

```
┌─ Claude Code ──┐         ┌─ Codex CLI ────┐
│ Stop/Notif hook│(可选)    │ notify 命令     │(可选)  ← 主动推送(实时,秒级)
│ projects/*.jsonl│        │ sessions/*.jsonl│        ← 被动文件(兜底,全覆盖)
└────────┬───────┘         └────────┬───────┘
         ▼                          ▼
   ┌─────────────────────────────────────┐
   │  状态聚合器(刷新时扫 jsonl + 合并事件) │
   │  → <supportPath>/state.json          │  ← 单一事实来源
   │  → <supportPath>/events/             │  ← hooks/notify 落的事件
   └──────────────────┬──────────────────┘
                      ▼
        Raycast menu-bar (定时读 state.json 渲染)
```

**状态存储位置**：Raycast `environment.supportPath`（`~/Library/Application Support/com.raycast.macos/extensions/<ext>/`）。卸载扩展自动清理，不污染 home。hook 脚本从固定位置读取该路径（Setup 时写入）。

### 被动层：扫 jsonl 推断状态

每次刷新按活跃窗口（默认 5min，可配）筛近期写入的会话文件，只 `tail` 末尾若干行 + 看 mtime 判定：

**Claude Code**（`~/.claude/projects/<编码cwd>/<uuid>.jsonl`，字段 `type`/`message.stop_reason`/`cwd`/`sessionId`/`timestamp`）：
- 末行 assistant + `stop_reason:tool_use`，mtime 近 ~30s → 🟢 运行中
- 末行 user(tool_result) → 🟢 运行中（模型即将响应）
- 末行 assistant + `end_turn` 无后续 → 🔵 已完成 / 等待你（结合 hook 区分）
- 含 `isApiErrorMessage`/error → 🔴 出错
- 超活跃窗口无写入 → ⚪ 空闲

**Codex**（`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，首行 `session_meta` 含 `cwd`；事件 `payload.type`）：
- 末事件 `task_complete` → 🔵 已完成
- `user_message` 后跟 response_item 串 → 🟢 运行中
- `token_count`/`agent_message` 持续追加 → 🟢 运行中
- error 事件 → 🔴 出错

> 关键：**mtime + 末行语义双重判定**，区分"刚停下"vs"卡住"。

### 主动层：hooks / notify（精准捕捉"轮到我了"）

被动层无法精准区分"停下等你"和"任务结束"。用主动推送补上：

- **CC hooks**（写 `~/.claude/settings.json`）：`Notification`→写 `waiting` 事件(🟡)；`Stop`→`done`(🔵)；`SessionStart`/`UserPromptSubmit`→标记活跃/开始。hook 命令形如 `codepulse-hook cc --event Notification --session "$SESSION_ID"`。
- **Codex notify**（写 `~/.codex/config.toml`）：`notify = ["codepulse-hook","codex"]`，Codex 事件发生时以参数传入事件 JSON，脚本解析落事件文件。

**注入策略（用户已定）**：不默认写。提供 **Setup Hooks** 命令，首次弹窗征求同意 → 说明改哪些文件、已备份 → 确认后写；随时可一键卸载还原。**未装 hooks 时纯文件监听仍可用**（"轮到我了"略不精准），保证零配置可用。

**安全约束**：①写前自动备份原配置；②hook 脚本极简，出错静默退出，绝不阻塞 CC/Codex；③扩展内提供安装/卸载开关。

### 去抖与时长

- 每会话记 `runningSince`，菜单显示"已运行 3m12s"
- 状态变化去抖：连续 2 次刷新一致才切换并触发通知，避免误判刷屏

## Raycast 扩展结构

### 命令

| 命令 | 类型 | 作用 |
|------|------|------|
| CodePulse（主） | `menu-bar` | 菜单栏状态聚合 + 下拉会话列表 |
| Setup Hooks | `no-view` | 安装/卸载 CC hooks + Codex notify（首次弹确认） |
| ~~Open Dashboard~~ | — | **推迟，MVP 不做** |

### 菜单栏标题（聚合，最紧急优先）

🟡N(等你) > 🟢N(运行中) > 🔵(全完成) > ⚪(全空闲)。偏好可选「只图标 / 图标+数字 / 图标+最紧急会话名」。

### 下拉菜单（MenuBarExtra）

```
🟡 轮到你了 (1)
  └ codePulse · Claude Code · 等待输入 · 2m前
🟢 运行中 (2)
  └ ai-gateway · Codex · 已运行 5m12s
  └ dax-trade-api · Claude Code · 已运行 18s
🔵 已完成 (1)
  └ loan-decision · Codex · 1m前完成
─────────────
⚙️ 设置 Hooks（未启用→点击安装）
🔄 刷新
```

会话项动作：主动作=切回 iTerm2 对应会话；副动作=复制 cwd / 打开 transcript。

### 偏好项（Preferences）

`活跃窗口分钟数`(默认5) · `刷新间隔`(默认5–10s) · `菜单栏样式` · `启用声音` · `监控范围`(全部/指定项目)。

## 切回 iTerm2 会话

**约束**：CC/Codex jsonl 都只有 `cwd`、无 tty/PID/窗口标识。只能靠 **cwd 匹配**。

**MVP 方案（已定）**：优先使用 iTerm2 Python API（已核验官方文档支持）遍历 session 的 `path` 变量找匹配 cwd → `async_activate(select_tab=True)` 聚焦具体标签。API 不可用时降级 AppleScript 唤起 iTerm2；仍失败则复制 cwd，提示用户手动切回。

**局限**：同项目多标签只切第一个匹配；终端内 `cd` 走后匹配失效。首次需在 iTerm2 授权 Python API。

## 错误处理

- jsonl 解析失败/写一半 → 跳过该行，用上一次有效状态
- supportPath 不存在 → 创建；写失败 → 静默降级为纯内存态
- iTerm2 未运行/API 未授权 → 降级 AppleScript 或仅复制路径
- hook 脚本任何异常 → 静默 exit 0，绝不阻塞 CC/Codex

## 测试策略

- 状态判定纯函数（输入 jsonl 末行片段 → 输出五态）：单元测试，覆盖五态 + 边界（写一半、mtime 临界、错误事件）
- 用真实 transcript 样本（本机 `~/.claude/projects`、`~/.codex/sessions`）做夹具
- hook 脚本：模拟 CC/Codex 传参，验证落事件文件格式正确、异常静默
- 端到端：开一个真实 CC 会话，观察菜单栏状态随运行/等待/完成翻转 + 通知触发

## 验证方式（End-to-End）

1. `npm run dev` 在 Raycast 加载扩展，菜单栏出现图标
2. 在 iTerm2 起一个 CC 会话跑长任务 → 菜单栏应显示 🟢 + 时长递增
3. CC 停下等输入 → 装了 hooks 应秒级变 🟡 并弹通知；未装 hooks 应在活跃窗口内由文件监听判定
4. 任务完成 → 🔵 + 通知
5. 点击会话项 → iTerm2 聚焦到对应项目标签
6. 起一个 Codex 会话重复 2–5
7. Setup Hooks：确认弹窗 → 写入 settings.json/config.toml 且生成 .bak 备份 → 卸载能还原

## 未决项

- 暂无阻塞 MVP 实现的未决项
