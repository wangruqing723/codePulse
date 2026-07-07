---
comet_change: refine-floating-companion-ui
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-07-refine-floating-companion-ui
status: final
---

# Refine Floating Companion UI Design

## Context

Floating Companion 已经收敛为 Electron 深色悬浮状态查看器。本次变更继续优化真实查看体验：Header 状态汇总必须稳定不折行，置顶按钮需要明确的激活/未激活态，会话卡片需要压缩为自然高度的两行布局，复制路径按钮需要可靠点击命中和轻量成功反馈。

OpenSpec delta 是需求事实源。本设计只说明实现边界、取舍和测试策略，不新增第二份需求定义。

## Confirmed Approach

采用现有 companion 模块边界内的紧凑 UI 重构方案：

- `src/companion/main.ts` 负责读取和同步 Electron `BrowserWindow.isAlwaysOnTop()` 状态，在切换置顶后立即向 renderer 发布新的 `isPinned`。
- `src/companion/view-model.ts` 负责状态汇总项、置顶状态、上下文文案、路径展示和时长字段的归一化。
- `src/companion/renderer.tsx` 负责 Header、窗口按钮、会话卡片和复制路径按钮的 DOM 结构与事件委托。
- `src/companion/styles.css` 负责深色视觉层级、紧凑两行卡片、状态圆点、置顶 active/inactive、hover 反馈和复制成功动画。

这个方案不新增依赖，不改变 transcript 扫描、状态推断、hook 事件、companion 安装更新或发布流程。

## Data Model

`FloatingViewModel` 增加 UI 专用字段：

- `isPinned?: boolean`：当前窗口 always-on-top 状态，驱动置顶按钮的 `aria-pressed`、`data-active` 和图钉视觉。
- `summaryItems?: FloatingStatusSummaryItem[]`：Header 一行状态汇总，按既有优先级仅展示运行中、已完成、错误、等待确认四态的非零数量。

`FloatingSessionViewModel` 继续作为卡片数据源，但上下文文案只在信息有增量价值时出现：

- 错误状态展示错误摘要。
- 等待确认状态展示等待原因或默认等待用户确认文案。
- 运行中或已完成状态不重复标题、agent 名或路径。

路径展示继续由 view model 生成中间截断文本，CSS ellipsis 只作为最后兜底；完整路径保留在 `title` 和复制值中。

## Rendering

Header 左侧保留 `CodePulse` eyebrow 和状态区域。状态区域优先渲染结构化 `summaryItems`，每个 summary item 是一组 inline-flex 内容：12px 状态圆点、数量、中文状态标签。容器使用 `flex-wrap: nowrap` 和 `white-space: nowrap`，避免 `🟢 1 运行中` 与 `🔵 1 完成` 折行。

Header 中不再渲染暗色垂直条、圆角矩形或其他无语义拖拽占位元素。

右上角窗口按钮固定为三个图标按钮：

1. `pin`：未置顶时灰色倾斜空心图钉和透明背景；置顶时白色垂直实心图钉、微弱白色背景和 `aria-pressed="true"`。
2. `minimize`：减号图标。
3. `close`：叉号图标。

卡片采用两行自然高度布局：

- 第一行左侧：状态圆点和主标题。
- 第一行右侧：agent 名称、分隔点和运行时长。
- 第二行左侧：12px、低透明度路径文本，保留完整路径 title。
- 第二行右侧：22px icon-only 复制路径按钮。

错误或等待状态如有额外上下文，可以追加一行单行截断摘要；没有额外日志信息时不渲染重复 footer，卡片高度由两行内容自然撑开。

## Interaction

窗口按钮与复制按钮继续使用事件委托。所有按钮内部 SVG 或 icon 元素设置 `pointer-events: none`，确保点击命中由父级 `button` 捕获。

复制路径优先调用 `navigator.clipboard.writeText(path)`。当浏览器剪贴板 API 不可用时，回退到 Electron bridge 的 `copyText(path)`。复制成功后，按钮短暂设置 `data-copied="true"`，由 CSS keyframes 提供轻量成功动画和绿色反馈。

Floating Companion 保持纯状态查看器定位。会话卡片唯一操作是复制路径，不新增终止进程、打开终端、启动或停止会话等控制入口。

## Styling

CSS 继续使用深色模式，但降低状态查看器的视觉噪音：

- Header summary dot 固定为 12px，状态色映射为绿色运行中、蓝色已完成、红色错误、黄色等待确认。
- 运行中状态点保留 pulse 动画；错误卡片保留微红边框和轻微内阴影。
- `.session-list` 使用 `grid-auto-rows: max-content`、`align-content: flex-start`、`align-items: start` 和小 gap，防止列表行拉伸卡片。
- `.session-item` 使用 column flex、`gap: 4px`、`height: fit-content`、`padding: 12px 16px`、`border-radius: 8px`，不使用 `min-height`、`flex-grow` 或纵向 `justify-content: space-between`。
- 每一行内部的左右元素都使用 `align-items: center` 做垂直居中。
- 路径文本使用 12px 和 `rgba(255, 255, 255, 0.45)`，与主标题形成明确层级。
- IconButton hover 使用轻微白色背景高亮，不增加额外布局重量。

## Alternatives Considered

### Renderer 内计算状态

把 Header summary 和 pin 状态计算留在 renderer 可以减少 view model 变更，但会让状态规则分散在 DOM 层，也更难用单元测试锁住排序、色调和空态。

### 抽出独立 UI helpers/components

把 Header、Card 和 Button 抽成多个 helper 会提升长期组织性，但当前 renderer 仍是小型 HTML 字符串模板。为了避免在 UI tweak 中引入额外结构成本，本次保持现有文件边界。

## Testing Strategy

- View model 单测覆盖状态汇总、四类状态映射、错误/等待上下文、上下文去重、路径展示和置顶状态透传。
- Renderer 单测覆盖 Header summary DOM、置顶 active/inactive、无 drag handle、两行卡片结构、复制按钮 DOM、图标点击命中、clipboard 写入和复制成功状态。
- Main 单测覆盖 pin action 切换 always-on-top 后立即发布 `isPinned`。
- CSS 文本断言覆盖 `pointer-events: none`、卡片无固定高度/无拉伸、列表防拉伸、行内垂直居中、路径 12px 暗色、hover 反馈和 copy-success 动画。
- 最终验证运行 `npm test`、`npm run lint`、`npm run build`、`npm run companion:build` 和 `git diff --check`。

## Risks

- 紧凑卡片可能让长标题、agent 元信息和路径互相挤压。缓解方式是对左右区域设置 `min-width: 0`、ellipsis 和固定尺寸复制按钮。
- `navigator.clipboard` 在部分测试或运行环境不可用。缓解方式是保留 Electron bridge fallback。
- 置顶状态如果只在点击时更新，下一次刷新可能显示旧态。缓解方式是每次构建 view model 时从 `BrowserWindow.isAlwaysOnTop()` 读取真实状态。
- CSS 文本断言不能替代完整视觉回归。缓解方式是保留本地 companion dev 验证路径，并用测试锁住关键布局约束。
