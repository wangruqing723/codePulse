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
