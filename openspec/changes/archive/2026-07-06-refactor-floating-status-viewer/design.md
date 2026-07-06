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

None. 用户已确认 Windows/WSL 唯一复制路径采用 UNC 优先，缺失时回退 WSL 路径。
