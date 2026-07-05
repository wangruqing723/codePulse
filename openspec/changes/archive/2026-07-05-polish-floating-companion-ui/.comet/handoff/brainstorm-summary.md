# Brainstorm Summary

- Change: polish-floating-companion-ui
- Date: 2026-07-04

## 确认的技术方案

采用方案 A：Raycast command 负责写出一份轻量偏好快照，Electron companion 在刷新状态时读取该快照。快照包含 `activeWindowMinutes` 和 `monitorProjects`。如果快照不存在或读取失败，companion 继续使用环境变量 `CODEPULSE_ACTIVE_WINDOW_MINUTES` / `CODEPULSE_MONITOR_PROJECTS`；环境变量也不存在时回退到当前默认 5 分钟。

图标按钮交互修复保持现有 `data-action` 协议不变，但 renderer click handler 改为从点击目标向上查找最近的 `[data-action]` 元素，确保用户点到按钮内部 icon `span` 时仍触发对应窗口动作。

## 关键取舍与风险

- 不让 Electron companion 直接依赖 Raycast API，避免跨运行时耦合。
- Raycast 从未运行过时，companion 会先使用兜底配置；这是可接受的兼容行为。
- 偏好快照只同步监控相关配置，不改变 Raycast hook、menu-bar 或 companion 生命周期分工。

## 测试策略

- renderer 测试覆盖点击 icon 内部元素仍触发 `hide`、`minimize`、`force-exit`。
- 偏好快照测试覆盖 Raycast 写入、companion 读取、环境变量兜底和默认值兜底。
- 运行 `npm test`、`npm run lint`、`npm run build`、`npm run companion:build`。

## Spec Patch

已回写 `openspec/changes/polish-floating-companion-ui/specs/wsl2-monitoring/spec.md`，补充图标按钮交互和 companion 共享 Raycast 监控偏好的验收场景。
