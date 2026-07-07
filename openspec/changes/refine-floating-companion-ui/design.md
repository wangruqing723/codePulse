## Context

Floating Companion 是 Electron 桌面端深色悬浮状态查看器。它当前已经读取会话状态并渲染 Header、窗口控制按钮和会话卡片，但 UI 在高密度状态查看场景里存在几个问题：头部状态容易拥挤折行，置顶按钮缺少明确开关态，卡片为两行信息却仍占用过多垂直空间，复制按钮和窗口按钮的图标点击命中需要更可靠。

本次变更发生在已有 companion 边界内：`main.ts` 负责窗口状态与模型发布，`view-model.ts` 负责只读状态数据归一化，`renderer.tsx` 和 `styles.css` 负责 DOM 与视觉呈现。

## Goals / Non-Goals

**Goals:**

- 保持深色模式和纯状态查看器定位。
- 让 Header 汇总、置顶状态和窗口控制按钮更清晰、稳定且不折行。
- 让会话卡片压缩为自然高度的两行信息布局，并严格保持四种状态色映射。
- 保留每张卡片唯一操作：复制路径，并提供可靠点击命中和轻量成功反馈。
- 用测试覆盖 view model、renderer DOM、点击事件和主进程置顶状态传播。

**Non-Goals:**

- 不新增终止进程、打开终端、启动或停止会话等控制能力。
- 不改变 transcript 扫描、状态推断、hook 事件摄取或安装更新 bootstrap 流程。
- 不新增外部 UI 依赖或改变 Electron 打包方式。

## Decisions

1. **用 view model 显式传递 Header 状态汇总和置顶状态**

   `FloatingViewModel` 增加 `summaryItems` 与 `isPinned`，renderer 只消费已归一化的数据。这样 Header 能稳定渲染四类状态的数字汇总，主进程切换 always-on-top 后也能立即把当前置顶状态发布给 renderer。

   Alternative considered: 在 renderer 内直接从 sessions 计算状态和查询 Electron 状态。该方案会把状态规则散落到 DOM 层，也不利于单元测试。

2. **卡片采用紧凑两行自然高度布局**

   单张卡片使用 column flex、固定小 gap 和 `height: fit-content`，列表容器用 `grid-auto-rows: max-content` 与 `align-content: flex-start` 防止拉伸。第一行承载状态点、标题、引擎和时长；第二行承载路径和复制按钮。错误与等待状态可以在有额外上下文时追加单行摘要，但不复制标题或引擎名称。

   Alternative considered: 保留三行布局并继续减少 padding。该方案仍会把路径、上下文和时长分散在过多垂直空间里，和悬浮窗的状态速览目标不匹配。

3. **按钮交互统一为父按钮接收点击**

   所有窗口按钮与复制按钮内部图标设置 `pointer-events: none`，事件委托统一通过父级 `button` 的 `data-action` 或 `data-copy-value` 识别。复制优先使用 `navigator.clipboard.writeText(path)`，再回退 Electron bridge，并通过短时 `data-copied` 状态驱动 CSS 动画。

   Alternative considered: 为每个图标分别绑定 click handler。该方案会增加 DOM 结构耦合，且不如事件委托容易覆盖。

4. **置顶按钮使用视觉状态而不是新增文字**

   未置顶时展示灰色倾斜空心图钉和透明背景；置顶时展示白色垂直实心图钉、`aria-pressed` 和微弱白色背景块。这样保持窗口控制组的图标化密度，同时让状态可感知。

   Alternative considered: 添加“已置顶/未置顶”文字标签。该方案会挤占 Header 状态汇总空间。

## Risks / Trade-offs

- [Risk] 更紧凑的卡片布局可能让长标题和路径互相挤压 → Mitigation: 行内左右区域均使用 `min-width: 0`、ellipsis 和稳定尺寸图标按钮。
- [Risk] `navigator.clipboard` 在某些环境不可用 → Mitigation: 保留 Electron bridge copy fallback。
- [Risk] 置顶状态若只在点击时更新，刷新模型时可能回到旧值 → Mitigation: 每次发布 view model 时从 `BrowserWindow.isAlwaysOnTop()` 获取当前状态。
- [Risk] 错误/等待上下文缺失时底部出现重复信息 → Mitigation: 只有真实错误摘要或等待原因时渲染上下文行。

## Migration Plan

- 该变更仅影响 companion UI 与本地测试，不需要数据迁移。
- 回滚方式是恢复 renderer、styles、view-model、main 和对应测试改动。

## Open Questions

None.
