---
comet_change: refactor-floating-status-viewer
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-06-refactor-floating-status-viewer
status: final
---

# Refactor Floating Status Viewer Design

## Context

Floating Companion 已经具备跨平台状态展示、路径复制、贴边隐藏和窗口生命周期能力，但当前悬浮窗仍混合了状态查看和恢复/控制入口。用户本轮目标是把它收敛为深色模式下的纯状态查看器：窗口内只显示进程状态、路径、只读上下文和时长，不再暴露终止进程、打开终端或强制退出受监控进程的控制操作。

OpenSpec delta 是需求事实源。本设计只约束实现方式和测试策略，不新增第二份需求定义。

## Confirmed Approach

采用方案 A：以 `src/companion/view-model.ts` 作为 UI 状态适配层。它负责把现有状态快照整理成 renderer 可以直接消费的字段，包括头部聚合摘要、四态卡片状态、状态色调、上下文摘要、路径显示文本、完整路径 tooltip、单一复制动作和时长文本。

`renderer.tsx` 保持为模板和事件委托层，不在 JSX/HTML 字符串中临时推断业务语义。`styles.css` 负责暗色视觉、状态圆点、运行中 pulse、错误边框、路径行和紧凑按钮状态。`main.ts` 与 `preload.ts` 只暴露窄窗口动作：`pin`、`minimize`、`close`，同时保留非 UI recovery IPC 能力给 Raycast Center 或 CLI 链路使用。

## Data Model

`FloatingViewModel` 增加 UI 专用字段，建议包括：

- `summaryItems` 或 `summaryText`：仅聚合运行中、已完成、错误、等待确认四态，优先突出错误。
- `displayStatus`：卡片展示状态，只允许 `running`、`done`、`error`、`waiting`。
- `statusTone`：四态颜色映射，运行中绿色、已完成蓝色、错误红色、等待确认黄色。
- `contextText`：错误摘要、等待原因或轻量更新时间语境。
- `durationText`：短格式存活时长，例如 `02:14`。
- `displayPath`：中间截断后的路径，例如 `~/.../my/plugin-todolist`。
- `fullPath`：完整路径，用于 `title` 和复制兜底。
- `copyAction`：每张卡片唯一复制动作。Windows/WSL 优先 UNC，生成失败时回退 WSL 路径；macOS 使用本机路径。

现有核心状态中的 `idle` 不进入卡片四态展示。view-model 可以过滤 idle session 或将其用于空态判断，但不能生成 idle tone 卡片。

## Rendering

头部左侧继续承载 CodePulse 身份和全局状态，但状态文案从单一 dominant 文案变为聚合摘要。摘要按错误、等待确认、运行中、已完成的固定顺序展示非零数量；存在错误时，外层 shell 可使用错误 tone 做轻微提示。

右上角按钮顺序固定为：

1. `pin`：图钉图标，切换 always-on-top。
2. `minimize`：减号图标，最小化窗口。
3. `close`：电源或叉号图标，关闭 companion 窗口，不终止受监控进程。

卡片顶部移除 “Codex 运行中” 这类重文本状态，改为状态圆点加 agent 名称。运行中圆点使用 CSS pulse；错误卡片使用低透明度红色边框。路径行采用 flex 布局，路径文本占满剩余空间并带 `title`，复制按钮位于同一行右侧，样式为 ghost/icon button。路径下方新增只读上下文行，右侧保留稳定尺寸的时长槽。

## IPC And Window Actions

renderer 的窗口动作只允许 `pin`、`minimize`、`close`，事件委托继续使用 `closest("[data-action]")` 处理按钮内部图标点击。`hide` 不再作为显式头部按钮出现；贴边隐藏仍由窗口位置、hover-enter 和 hover-leave 流程触发。

`preload.ts` 的公开 bridge 类型应移除悬浮窗可见动作里的 `force-exit` 和 `hide`。`forceExitCompanion()` 如果仍被 Raycast recovery 链路使用，可以保留为非 renderer 可见能力，但不要被窗口按钮引用。

`main.ts` 的 `handleWindowAction` 增加：

- `pin`：读取当前 always-on-top 状态并切换 `setAlwaysOnTop`。
- `minimize`：沿用现有最小化前清理 docked 状态的逻辑。
- `close`：关闭 companion 窗口或退出 companion 进程，不调用任何受监控 Claude/Codex 进程终止逻辑。

## Styling

CSS 继续保持深色模式基调，但降低按钮和路径的视觉重量：

- 用 CSS custom properties 定义四态颜色，避免状态色散落在多个选择器。
- `.status-dot[data-status="running"]` 添加 pulse animation。
- `.session-card[data-status="error"]` 使用轻微红色 border 和内阴影警示。
- 路径文本使用 `min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis`、`white-space: nowrap` 作为兜底。
- 复制按钮使用透明背景、细边框或 hover 背景，不再使用实心高权重按钮。
- 上下文与时长使用 12px、低对比灰色，并固定时长槽宽度，避免挤压路径。

## Testing Strategy

先写 focused tests 锁住语义，再改实现：

- view-model：覆盖聚合摘要排序、四态卡片状态、idle 排除、错误/等待上下文、duration 文本、Windows UNC 优先单一复制动作。
- renderer：覆盖 `pin`、`minimize`、`close` 三个按钮，点击内部图标也能触发；确认没有可见 `force-exit` 或 `hide` 控件；确认路径带 `title`，复制按钮与路径同行。
- preload/main：覆盖 window action 类型收敛、pin toggle、minimize、close 不终止受监控进程。
- CSS/视觉：通过 companion dev 或截图检查暗色 UI、状态圆点、错误边框、路径截断、上下文行和时长槽没有重叠。

最终验证运行 focused tests、`npm run lint`、`npm run build` 和 `npm run companion:build`。若当前环境无法完整启动 Electron GUI，应记录未验证的平台视觉风险。

## Risks

- 核心状态仍有 `idle`，但 UI 卡片只允许四态。缓解方式是在 view-model 层过滤，避免 renderer/CSS 出现第五种 tone。
- 纯 CSS 中间截断跨浏览器不稳定。缓解方式是 view-model 生成短显示路径，CSS ellipsis 只做最终兜底。
- 移除可见 force-exit 入口会降低窗口内恢复可发现性。缓解方式是保留 Raycast Center / CLI recovery 能力，本 change 只移除悬浮窗内控制入口。
- Pin 状态需要主进程维护真实 always-on-top。缓解方式是把 pin 作为独立 window action 测试，不把它混入卡片状态逻辑。
