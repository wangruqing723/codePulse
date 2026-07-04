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
