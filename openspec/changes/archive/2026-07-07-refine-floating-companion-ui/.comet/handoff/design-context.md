# Comet Design Handoff

- Change: refine-floating-companion-ui
- Phase: design
- Mode: compact
- Context hash: 4174e82bb5a748519f75d1ec1212943254f492c4195e6b7f2d6b59bb6ae878e6

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/refine-floating-companion-ui/proposal.md

- Source: openspec/changes/refine-floating-companion-ui/proposal.md
- Lines: 1-30
- SHA256: 5a71559d65a282a9afe1d6dc787bb499c77308cefcd4e0874c7058d555cd4ae7

```md
## Why

Floating Companion 已经能作为深色悬浮状态查看器展示会话，但当前头部统计、置顶控件和会话卡片的信息密度与状态表达仍不够清晰。用户在实际查看多会话状态时，需要更紧凑、明确且不误触的只读界面。

## What Changes

- 重构悬浮窗 Header：使用不折行的状态数字汇总，并移除无意义的拖拽占位视觉元素。
- 优化右上角窗口控制组：保留置顶、最小化、关闭三个桌面端图标按钮，并让置顶按钮有明确的激活/未激活视觉状态。
- 将会话卡片压缩为紧凑两行布局：第一行展示状态点、标题、引擎与时长；第二行展示截断路径与复制路径图标按钮。
- 固定四类状态的视觉映射：运行中绿色、已完成蓝色、错误红色、等待确认黄色；运行中状态点使用 pulse，错误卡片保留红色边框警示。
- 保持 Floating Companion 的只读属性：卡片内唯一操作仍为复制路径，不新增终止进程、打开终端或启动/停止会话操作。
- 修复图标按钮点击命中与复制反馈：图标内部不截获点击，复制按钮使用剪贴板写入路径并提供轻量成功动画。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wsl2-monitoring`: Clarify and tighten Floating Companion header, card layout, pin control, icon-button click handling, and copy-path feedback requirements.

## Impact

- `src/companion/renderer.tsx`：Header、窗口按钮、会话卡片结构、复制交互。
- `src/companion/styles.css`：深色模式视觉层级、状态点、紧凑两行卡片、图标按钮 hover/active/copy 动画。
- `src/companion/view-model.ts`：置顶状态、状态汇总项、上下文文案和时长展示数据。
- `src/companion/main.ts`：置顶状态同步到 renderer view model。
- Companion renderer、view model 和 main 相关测试。
```

## openspec/changes/refine-floating-companion-ui/design.md

- Source: openspec/changes/refine-floating-companion-ui/design.md
- Lines: 1-63
- SHA256: cb8ec39d85cc0ff93d087c97b6afbc2555ecb24d6cd91c49c05ba62d9ad25887

```md
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
```

## openspec/changes/refine-floating-companion-ui/tasks.md

- Source: openspec/changes/refine-floating-companion-ui/tasks.md
- Lines: 1-29
- SHA256: d66d715a806755b52bd6a23378105b7bac90edb0cfaa779de955b22070a5649e

```md
## 1. View Model And Window State

- [ ] 1.1 Add Floating Companion view-model fields for status summary items and current pin state.
- [ ] 1.2 Propagate Electron always-on-top state from the main process into renderer updates.
- [ ] 1.3 Keep status summary ordering and color tone data limited to running, completed, error, and waiting.

## 2. Header And Controls

- [ ] 2.1 Render Header status summary as one-line flex items with 12px status dots and no wrapping.
- [ ] 2.2 Remove the non-semantic Header drag-handle placeholder from renderer markup and CSS.
- [ ] 2.3 Render pin, minimize, and close as icon buttons with hover feedback and clear pin active/inactive states.

## 3. Session Cards

- [ ] 3.1 Rework each session card into a compact natural-height two-row layout.
- [ ] 3.2 Preserve fixed status color mapping, running pulse animation, and error-card red border treatment.
- [ ] 3.3 Keep paths dark, 12px, truncated with full-path title, and aligned with the copy icon button.
- [ ] 3.4 Remove duplicate bottom context text when there is no error or waiting reason.

## 4. Copy Interaction

- [ ] 4.1 Ensure window and copy button icons do not intercept pointer events from their parent buttons.
- [ ] 4.2 Implement copy-path click handling with `navigator.clipboard.writeText(path)` and Electron bridge fallback.
- [ ] 4.3 Add a lightweight copied-success visual animation for the icon-only copy button.

## 5. Verification

- [ ] 5.1 Add or update renderer, view-model, and main-process tests for the UI and interaction changes.
- [ ] 5.2 Run unit tests, lint, builds, companion build, and whitespace checks.
```

## openspec/changes/refine-floating-companion-ui/specs/wsl2-monitoring/spec.md

- Source: openspec/changes/refine-floating-companion-ui/specs/wsl2-monitoring/spec.md
- Lines: 1-147
- SHA256: 56c6adf5fe4053054e54d243420f3a8263e59b160617c35354c4b6b55aef1fb6

[TRUNCATED]

```md
## MODIFIED Requirements

### Requirement: 跨平台悬浮窗状态 companion
系统 SHALL 提供一个 Electron floating companion，在 Windows 和 macOS 上以深色模式悬浮窗形式运行，并在用户不打开 Raycast command 的情况下展示 CodePulse 会话状态。该悬浮窗 SHALL 作为纯状态查看器，不在悬浮窗内提供终止进程、打开终端或启动/停止会话等控制操作。

#### Scenario: 悬浮窗展示聚合状态摘要
- **WHEN** 至少一个受监控的 Claude Code 或 Codex CLI 会话处于运行中、已完成、错误或等待确认状态
- **THEN** 悬浮窗头部展示这些状态的数字汇总
- **AND** 汇总仅使用运行中、已完成、错误和等待确认这四种状态
- **AND** 汇总项使用 12px 状态圆点与文本在同一行水平居中对齐
- **AND** 汇总文本不得折行

#### Scenario: 错误状态优先突出
- **WHEN** 至少一个受监控会话处于错误状态，且其他会话处于运行中、已完成或等待确认状态
- **THEN** 悬浮窗将错误作为最高优先级状态突出展示
- **AND** 仍可展示其他非零状态的数字汇总

#### Scenario: 悬浮窗默认置顶
- **WHEN** floating companion 启动
- **THEN** 悬浮窗默认以 always-on-top 方式显示在其他普通窗口之上
- **AND** 置顶控件展示白色垂直实心图钉和微弱白色激活背景

#### Scenario: 用户切换置顶
- **WHEN** 用户点击悬浮窗头部的置顶控件
- **THEN** companion 切换窗口 always-on-top 状态
- **AND** 不停止后台状态刷新
- **AND** 未置顶时置顶控件展示灰色倾斜空心图钉和透明背景
- **AND** 已置顶时置顶控件展示白色垂直实心图钉和微弱白色激活背景

#### Scenario: 用户最小化悬浮窗
- **WHEN** 用户点击悬浮窗头部的最小化控件
- **THEN** companion 最小化悬浮窗
- **AND** 不停止后台状态刷新

#### Scenario: 用户关闭悬浮窗
- **WHEN** 用户点击悬浮窗头部的关闭控件
- **THEN** companion 关闭悬浮窗进程
- **AND** 不对任何受监控 Claude Code 或 Codex CLI 进程执行终止操作

#### Scenario: 头部不展示无意义占位元素
- **WHEN** 悬浮窗 Header 渲染
- **THEN** Header 不展示暗色垂直条、圆角矩形占位符或其他无语义拖拽装饰

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

#### Scenario: 复制按钮写入路径并展示反馈
- **WHEN** 用户点击会话卡片路径行最右侧的复制图标按钮
- **THEN** companion 使用可用剪贴板 API 写入该会话路径
- **AND** 复制按钮展示短暂成功反馈动画
```

Full source: openspec/changes/refine-floating-companion-ui/specs/wsl2-monitoring/spec.md

