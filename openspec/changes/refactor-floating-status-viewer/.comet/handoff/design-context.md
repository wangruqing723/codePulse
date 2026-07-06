# Comet Design Handoff

- Change: refactor-floating-status-viewer
- Phase: design
- Mode: compact
- Context hash: d9f879c83bcf558eee6aadce6b2a53ba264277e50ef59c0a769e251be954b81b

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/refactor-floating-status-viewer/proposal.md

- Source: openspec/changes/refactor-floating-status-viewer/proposal.md
- Lines: 1-30
- SHA256: d204e91684fb068da1a0964d24b6ca55121b72748e8d27a63d34443dc72be972

```md
## Why

Electron Floating Companion 当前混合了状态查看和恢复/控制入口，右上角图标表意不够清楚，单个会话卡片的信息层级也偏重。用户希望它成为一个深色模式下的纯状态查看器：一眼看清进程状态、路径和必要上下文，同时不提供终止进程、打开终端等控制操作。

## What Changes

- 将悬浮窗头部控制区重构为 `Pin`、`Minimize`、`Close` 三个标准桌面图标按钮，并移除悬浮窗内可见的强制退出/终止进程入口。
- 将全局状态文案从单一 dominant 文案升级为状态聚合摘要，优先突出错误，也可展示运行、错误、等待、完成的数字汇总。
- 将卡片状态视觉压到四类：运行中为绿色、已完成为蓝色、错误为红色、等待确认为黄色。
- 用状态圆点和运行中 pulse 动画替代卡片顶部的纯文本状态；错误卡片用轻微红色边框提示。
- 重排卡片信息层级：标题和状态更清楚，路径中间截断并保留完整路径 tooltip，复制路径成为路径行右侧的唯一操作。
- 在路径下方展示只读上下文：错误摘要、等待原因或更新时间语境，并在右下角预留/展示进程存活时长。
- Windows/WSL 场景下每张卡片仅保留一个复制路径动作，优先复制 `\\wsl$...` UNC 路径，缺失时回退 WSL 路径。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wsl2-monitoring`: Floating Companion 的状态窗、窗口控制、状态色、路径复制和会话卡片只读展示行为发生变化。

## Impact

- Affected code: `src/companion/renderer.tsx`, `src/companion/styles.css`, `src/companion/view-model.ts`, `src/companion/preload.ts`, `src/companion/main.ts`, and focused companion tests.
- Affected specs: `openspec/specs/wsl2-monitoring/spec.md` via delta spec.
- No new runtime dependency is expected.
- Raycast Center 的 companion recovery 入口不在本 change 中移除；本 change 只移除悬浮窗内的控制/恢复入口。
```

## openspec/changes/refactor-floating-status-viewer/design.md

- Source: openspec/changes/refactor-floating-status-viewer/design.md
- Lines: 1-81
- SHA256: cf284f7c3b16958e7e0c7be3c525943864c6e5105b9a92ff5298615df2f28bca

[TRUNCATED]

```md
## Context

Floating Companion 当前承担跨平台状态展示、贴边隐藏、路径复制和一部分恢复控制入口。现有 renderer 以 `hide`、`minimize`、`force-exit` 三个图标按钮作为窗口操作，卡片顶部用 agent/status 文本显示状态，路径和复制按钮分行展示。用户的新目标更清晰：悬浮窗只作为状态查看器，不在卡片或窗口内提供终止进程、打开终端等控制操作。

现有状态核心仍包含 `idle`，但本次卡片视觉只允许四种状态：运行中、已完成、错误、等待确认。`idle` 不应进入卡片状态色体系；没有可展示会话时继续走空态。

## Goals / Non-Goals

**Goals:**

- 保持深色模式基调，同时降低卡片噪音和按钮视觉重量。
- 将头部控制明确为 `Pin`、`Minimize`、`Close`，顺序固定，图标语义清楚。
- 将会话卡片变成只读状态项：状态圆点、标题、路径、上下文摘要、时长和唯一复制路径操作。
- 严格统一状态色：运行中绿色、已完成蓝色、错误红色、等待确认黄色。
- Windows/WSL 只提供一个复制路径动作，优先复制 UNC 路径，缺失时回退 WSL 路径。
- 保留 Raycast Center 或 CLI 层的 companion recovery 能力，不让悬浮窗继续暴露强制退出。

**Non-Goals:**

- 不新增终止进程、打开终端、聚焦窗口、启动/停止 session 等控制操作。
- 不重写扫描器或改变 session 状态推断语义。
- 不新增外部 UI 组件库或图标依赖。
- 不处理 companion 安装、签名、自动更新或开机启动。

## Decisions

### 1. 头部采用状态摘要 + 三个窗口级动作

头部左侧继续展示 `CodePulse` 和全局状态，但文案从单一 dominant 文案升级为聚合摘要。摘要按错误、等待确认、运行中、已完成的顺序输出非零状态数量；如果存在错误，整体 status 仍以错误作为 shell 的重点状态，便于边框/背景做轻提示。

右侧动作改为：

- `pin`: 切换 `alwaysOnTop`，图标用图钉字符或 CSS 图标，title/aria-label 为“置顶”。
- `minimize`: 最小化窗口，图标用减号。
- `close`: 关闭 companion 窗口，图标用电源或叉号。

`hide` 不再作为显式按钮出现；贴边隐藏仍由拖拽到边缘和 hover 流程自然触发。`force-exit` 从悬浮窗 UI 与 renderer window action 中移除，底层 IPC 可保留给 Raycast recovery 或 CLI 恢复链路。

### 2. View model 提供 UI 专用状态语义

renderer 不应在模板里临时推断状态摘要、错误原因和时长。`view-model.ts` 增加 UI 专用字段，例如：

- `summaryText`: 头部聚合状态摘要。
- `displayStatus`: 卡片四态之一，用于 class/data attribute。
- `statusTone`: 与四态颜色映射对应。
- `contextText`: 错误摘要、等待原因或轻量更新时间语境。
- `durationText`: 使用 `runningSince`、`completedAt` 或 `updatedAt` 派生的短时长文本。
- `displayPath` / `fullPath`: 用于中间截断显示和 tooltip。

这样测试可以直接覆盖状态与复制策略，CSS/HTML 只负责展示。

### 3. 卡片布局改为两行主信息 + 一行上下文

卡片顶部用状态圆点加 agent 名称替代 “Codex 运行中” 纯文本。运行中圆点使用 CSS pulse 动画；错误卡片边框使用轻微红色透明边框。标题保持一行截断。路径行使用 `display: flex`，路径占据剩余宽度，复制按钮在右侧。路径显示采用 JS 生成的中间截断短文本，CSS 再用 `text-overflow: ellipsis` 做最终兜底，并保留 `title` 为完整路径。

复制按钮使用 ghost/icon button，视觉低于状态和标题。由于用户要求唯一操作，Windows session 只生成一个 `复制路径` 动作，优先使用 UNC 路径；macOS 使用本机路径。

### 4. 只读上下文行不引入新控制

路径下方新增 12px 灰色上下文行。错误状态展示 `errorMessage` 的单行截断；等待状态展示可用的 pending/context 文案，否则使用“等待用户确认”；运行中/已完成可展示最近更新时间语境或留空。右下角预留 `durationText`，即使某些 session 暂时无法计算也保持布局稳定。

## Risks / Trade-offs

- [Risk] `idle` 仍存在于核心状态，但用户要求卡片四态。→ Mitigation: view model 过滤或映射可展示 session，空闲只影响空态，不进入卡片 tone。
- [Risk] 中间截断无法只靠 CSS 完成跨浏览器稳定效果。→ Mitigation: view model 生成 `~/.../<tail>` 显示文本，CSS ellipsis 兜底，`title` 保留完整路径。
- [Risk] 移除悬浮窗强制退出入口可能降低卡死恢复可见性。→ Mitigation: Raycast Center recovery 入口保留，本 change 明确仅移除悬浮窗内控制入口。
- [Risk] Pin 状态切换需要主进程实际支持 `setAlwaysOnTop`。→ Mitigation: 在 main/preload 中新增窄 window action，不影响扫描和复制路径链路。

## Migration Plan

1. 先更新 view-model 和测试，固定状态摘要、四态卡片语义、UNC 优先复制策略。
2. 更新 renderer HTML 与交互测试，移除 `hide`/`force-exit` 可见动作，新增 `pin`/`close` 动作。
3. 更新 main/preload 的窗口动作类型和处理逻辑，支持 pin toggle 和 close。
4. 更新 CSS 完成暗色视觉、状态圆点、pulse、错误边框、路径行和上下文行。
5. 运行 focused tests、lint、build 和 companion build；必要时用 companion dev 截图人工检查布局。

Rollback 策略：若新 UI 出现阻塞，可回退 renderer/CSS/view-model 相关改动；Raycast menu-bar、扫描器和 recovery 辅助模块不受影响。

## Open Questions

```

Full source: openspec/changes/refactor-floating-status-viewer/design.md

## openspec/changes/refactor-floating-status-viewer/tasks.md

- Source: openspec/changes/refactor-floating-status-viewer/tasks.md
- Lines: 1-20
- SHA256: 5336aee92c45905f1f069f1c433b6e11679657eb80ffd699e1b54d765d195fae

```md
## 1. View Model And State Semantics

- [ ] 1.1 Add focused view-model tests for status summary ordering, four-state card display, context text, duration text, and idle exclusion.
- [ ] 1.2 Update `src/companion/view-model.ts` to expose UI-ready summary/card fields and Windows UNC-first single copy action.

## 2. Window Actions

- [ ] 2.1 Add focused renderer/main/preload tests for `pin`, `minimize`, and `close` actions and for removal of visible `force-exit`/`hide` controls.
- [ ] 2.2 Update `src/companion/preload.ts` and `src/companion/main.ts` so the floating window supports pin toggle, minimize, and close while retaining non-UI recovery IPC where needed.

## 3. Renderer And Styling

- [ ] 3.1 Refactor `src/companion/renderer.tsx` card markup for status dot, title, path row, ghost copy action, context row, tooltip, and duration slot.
- [ ] 3.2 Refactor `src/companion/styles.css` for dark status viewer polish, four-tone state colors, running pulse animation, error border, path truncation, and stable compact controls.

## 4. Verification

- [ ] 4.1 Run focused companion unit tests covering view-model, renderer, and main window actions.
- [ ] 4.2 Run `npm run lint`, `npm run build`, and `npm run companion:build`.
- [ ] 4.3 Launch or otherwise visually inspect the companion layout and record any unverified platform-specific residual risk.
```

## openspec/changes/refactor-floating-status-viewer/specs/wsl2-monitoring/spec.md

- Source: openspec/changes/refactor-floating-status-viewer/specs/wsl2-monitoring/spec.md
- Lines: 1-116
- SHA256: 1db2865bddbfc095582902ab4b7e05fa8c3e18986df233434451e1435b8c5a8f

[TRUNCATED]

```md
## MODIFIED Requirements

### Requirement: 跨平台悬浮窗状态 companion
系统 SHALL 提供一个 Electron floating companion，在 Windows 和 macOS 上以深色模式悬浮窗形式运行，并在用户不打开 Raycast command 的情况下展示 CodePulse 会话状态。该悬浮窗 SHALL 作为纯状态查看器，不在悬浮窗内提供终止进程、打开终端或启动/停止会话等控制操作。

#### Scenario: 悬浮窗展示聚合状态摘要
- **WHEN** 至少一个受监控的 Claude Code 或 Codex CLI 会话处于运行中、已完成、错误或等待确认状态
- **THEN** 悬浮窗头部展示这些状态的数字汇总
- **AND** 汇总仅使用运行中、已完成、错误和等待确认这四种状态

#### Scenario: 错误状态优先突出
- **WHEN** 至少一个受监控会话处于错误状态，且其他会话处于运行中、已完成或等待确认状态
- **THEN** 悬浮窗将错误作为最高优先级状态突出展示
- **AND** 仍可展示其他非零状态的数字汇总

#### Scenario: 悬浮窗默认置顶
- **WHEN** floating companion 启动
- **THEN** 悬浮窗默认以 always-on-top 方式显示在其他普通窗口之上

#### Scenario: 用户切换置顶
- **WHEN** 用户点击悬浮窗头部的置顶控件
- **THEN** companion 切换窗口 always-on-top 状态
- **AND** 不停止后台状态刷新

#### Scenario: 用户最小化悬浮窗
- **WHEN** 用户点击悬浮窗头部的最小化控件
- **THEN** companion 最小化悬浮窗
- **AND** 不停止后台状态刷新

#### Scenario: 用户关闭悬浮窗
- **WHEN** 用户点击悬浮窗头部的关闭控件
- **THEN** companion 关闭悬浮窗进程
- **AND** 不对任何受监控 Claude Code 或 Codex CLI 进程执行终止操作

#### Scenario: 贴边后自动隐藏大半部分
- **WHEN** 用户将悬浮窗拖到屏幕边缘并移开鼠标
- **THEN** 悬浮窗自动隐藏大半部分，只保留可见状态边栏

#### Scenario: 鼠标移入贴边窗口后展开
- **WHEN** 悬浮窗处于贴边隐藏状态且鼠标移动到可见区域
- **THEN** 悬浮窗展开为完整窗口

#### Scenario: 鼠标移开后再次贴边隐藏
- **WHEN** 贴边悬浮窗已展开且鼠标移出窗口区域
- **THEN** 悬浮窗再次隐藏大半部分

#### Scenario: 开发模式首次启动保持可交互
- **WHEN** 维护者第一次运行 `npm run companion:dev` 启动 floating companion
- **THEN** 悬浮窗不会进入不可点击、不可触发 hover 的贴边隐藏状态
- **AND** 不需要关闭终端后第二次运行命令才能恢复正常交互

### Requirement: 路径复制动作
系统 SHALL 允许用户从悬浮窗会话列表复制受监控会话路径。每个会话卡片 SHALL 仅展示一个复制路径动作。

#### Scenario: Windows 优先复制 UNC 路径
- **WHEN** Windows 用户对默认发行版名为 `Ubuntu` 且 cwd 为 `/home/user/project` 的会话选择复制路径动作
- **THEN** 剪贴板收到 `\\wsl$\Ubuntu\home\user\project`

#### Scenario: Windows UNC 不可用时回退 WSL 路径
- **WHEN** Windows 用户对 cwd 为 `/home/user/project` 的会话选择复制路径动作
- **AND** companion 无法为该会话生成 UNC 路径
- **THEN** 剪贴板收到 `/home/user/project`

#### Scenario: macOS 复制本机路径
- **WHEN** macOS 用户对 cwd 为 `/Users/me/project` 的会话选择复制路径动作
- **THEN** 剪贴板收到 `/Users/me/project`

### Requirement: Floating companion 图标按钮交互
系统 SHALL 在窗口操作按钮使用图标化内容时，仍正确处理用户对按钮内部图标元素的点击。窗口操作按钮 SHALL 仅包含置顶、最小化和关闭。

#### Scenario: 点击置顶图标内部元素
- **WHEN** 用户点击置顶按钮内部的图标元素
- **THEN** companion 触发 `pin` 窗口动作

#### Scenario: 点击最小化图标内部元素
- **WHEN** 用户点击最小化按钮内部的图标元素
- **THEN** companion 触发 `minimize` 窗口动作

#### Scenario: 点击关闭图标内部元素
- **WHEN** 用户点击关闭按钮内部的图标元素
```

Full source: openspec/changes/refactor-floating-status-viewer/specs/wsl2-monitoring/spec.md

