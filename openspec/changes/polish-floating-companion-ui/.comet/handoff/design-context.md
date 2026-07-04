# Comet Design Handoff

- Change: polish-floating-companion-ui
- Phase: design
- Mode: compact
- Context hash: fda50d3654d87b9cdc53f2a6a94da88c12c21c81488793b75df84feaf724a864

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/polish-floating-companion-ui/proposal.md

- Source: openspec/changes/polish-floating-companion-ui/proposal.md
- Lines: 1-28
- SHA256: d75496faf389dc231ac12ee97f28cbc546d288a42cc555cfc64fbe7ceafb6bc2

```md
## Why

macOS floating companion 截图中暴露出顶部区域偏拥挤的问题：状态文字、拖拽柄和三个文字按钮同时挤在 340px 宽窗口里，视觉层级不够清爽。随后验证发现图标化后点击内部图标没有触发窗口动作，同时 companion 监控窗口仍使用默认 5 分钟，没有继承 Raycast 配置的监控时间。

这个改动需要把原 UI polish 升级为完整变更：既修复图标按钮交互回归，也补齐 Raycast 偏好与 Electron companion 之间的配置同步，让 companion 的监控范围与用户在 Raycast 中配置的一致。

## What Changes

- 将隐藏、最小化、强制退出从中文文字按钮调整为固定尺寸图标按钮，并保留 `title` / `aria-label`。
- 修复点击图标内部元素时没有触发 `hide`、`minimize`、`force-exit` 的交互回归。
- 优化 header 布局，让状态文字、拖拽柄和窗口操作区在窄窗口中不互相抢宽。
- 让 Electron companion 使用 Raycast 配置的 `activeWindowMinutes` 和 `monitorProjects`，并在无配置快照时保留环境变量 / 默认值兜底。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `wsl2-monitoring`: 补充 floating companion 图标按钮交互和 Raycast 监控偏好同步的验收场景。

## Impact

- 影响 `src/companion/renderer.tsx`、`src/companion/styles.css`、companion 状态源和 Raycast command 偏好同步代码。
- 补充 renderer 事件委托测试和 companion 偏好读取测试。
- 不改变状态推断算法、路径复制语义或打包配置。
```

## openspec/changes/polish-floating-companion-ui/design.md

- Source: openspec/changes/polish-floating-companion-ui/design.md
- Lines: 1-17
- SHA256: e5c9aedf3c59ac974196ca48580f96dcbdab16d5a66c5d7202492597eee9d140

```md
## 实现说明

此变更从 UI polish 升级为完整流程，范围包含两个相关问题。

1. 图标按钮交互

保持 `data-action` 协议不变，但 click handler 不能只读取 `event.target.dataset.action`。图标按钮内部有 `span`，用户实际点击时 target 可能是内部图标元素，因此 renderer 需要向上查找最近的 `[data-action]` 按钮，再触发对应 window action。

2. Raycast 偏好同步

Raycast command 能通过 `getPreferenceValues()` 读取 `activeWindowMinutes` / `monitorProjects`，但 Electron companion 是独立进程，当前只读取环境变量或默认值。方案是在 Raycast supportPath 下写入一份轻量偏好快照，companion 刷新状态时读取该快照并与环境变量兜底合并。这样不改变 Raycast 偏好来源，也不要求 Electron 直接依赖 Raycast API。

## 验证方式

- 为 renderer 增加点击内部图标仍触发窗口动作的单元测试。
- 为 companion 偏好快照读取增加单元测试，覆盖 Raycast 快照优先、环境变量兜底和默认值兜底。
- 运行项目测试、lint、Raycast build 和 companion build。
```

## openspec/changes/polish-floating-companion-ui/tasks.md

- Source: openspec/changes/polish-floating-companion-ui/tasks.md
- Lines: 1-11
- SHA256: a6983a15befb7185594adfdeb1e5dd2bd7cd46c266ce650ffc3a8d5140b33659

```md
## 1. Floating companion 顶部 polish

- [x] 1.1 将窗口操作按钮改为紧凑图标按钮，并保留可访问标签
- [x] 1.2 调整 header / 按钮 / 状态文字 CSS，降低窄窗口拥挤感
- [x] 1.3 补充 renderer 测试并运行轻量验证

## 2. 交互回归与偏好同步

- [ ] 2.1 修复点击图标内部元素时窗口操作不触发的问题，并补充失败优先测试
- [ ] 2.2 让 companion 使用 Raycast 配置的监控窗口和项目过滤偏好，并补充失败优先测试
- [ ] 2.3 运行完整验证并同步 Comet 状态
```

## openspec/changes/polish-floating-companion-ui/specs/wsl2-monitoring/spec.md

- Source: openspec/changes/polish-floating-companion-ui/specs/wsl2-monitoring/spec.md
- Lines: 1-31
- SHA256: 0c3c5e1a09ece69f197536d5f5de73228e78a56ca910a142fb9e9578d2661295

```md
## ADDED Requirements

### Requirement: Floating companion 图标按钮交互
系统 SHALL 在窗口操作按钮使用图标化内容时，仍正确处理用户对按钮内部图标元素的点击。

#### Scenario: 点击隐藏图标内部元素
- **WHEN** 用户点击隐藏按钮内部的图标元素
- **THEN** companion 触发 `hide` 窗口动作

#### Scenario: 点击最小化图标内部元素
- **WHEN** 用户点击最小化按钮内部的图标元素
- **THEN** companion 触发 `minimize` 窗口动作

#### Scenario: 点击强制退出图标内部元素
- **WHEN** 用户点击强制退出按钮内部的图标元素
- **THEN** companion 触发 `force-exit` 窗口动作

### Requirement: Companion 共享 Raycast 监控偏好
系统 SHALL 让 Electron floating companion 使用 Raycast 中配置的监控窗口和项目过滤偏好，并在配置快照不可用时保留安全兜底。

#### Scenario: 使用 Raycast 监控窗口分钟数
- **WHEN** Raycast 配置的 `activeWindowMinutes` 为 `30`
- **THEN** companion 扫描和事件合并使用 30 分钟作为活跃窗口

#### Scenario: 使用 Raycast 项目过滤
- **WHEN** Raycast 配置的 `monitorProjects` 包含项目路径前缀
- **THEN** companion 使用同一项目路径前缀过滤受监控会话

#### Scenario: 偏好快照不可用时使用兜底
- **WHEN** companion 无法读取 Raycast 偏好快照
- **THEN** companion 使用环境变量配置；若环境变量也不存在，则使用默认 5 分钟监控窗口
```

