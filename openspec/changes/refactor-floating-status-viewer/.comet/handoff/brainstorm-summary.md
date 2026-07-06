# Brainstorm Summary

- Change: refactor-floating-status-viewer
- Date: 2026-07-06

## 确认的技术方案

采用方案 A：以 view-model 为状态展示适配层，把四态卡片语义、聚合摘要、UNC 优先复制、上下文文案、路径短显示和时长文本都整理成 renderer 可直接消费的字段；renderer 只负责模板和事件委托；CSS 负责深色视觉、状态色、pulse、错误边框和稳定布局；main/preload 只新增窄窗口动作 `pin`、`minimize`、`close`。

## 关键取舍与风险

- 取舍：保留 Raycast Center / CLI recovery 能力，但从悬浮窗 UI 移除 `force-exit`。
- 取舍：Windows/WSL 每卡片唯一复制路径采用 UNC 优先，缺失时回退 WSL 路径。
- 风险：核心状态仍有 `idle`，但卡片状态只允许四态。候选处理为 view-model 过滤 idle，让 idle 只参与空态/无活跃会话判断。
- 风险：纯 CSS 中间截断不稳定。候选处理为 view-model 生成短路径，CSS ellipsis 兜底，`title` 保留完整路径。

## 测试策略

先写 view-model 单元测试覆盖摘要排序、四态字段、上下文、duration、UNC 优先复制；再写 renderer HTML/事件测试覆盖 `pin/minimize/close`、无 `force-exit/hide` 可见入口、路径 title 和卡片结构；最后写 main/preload focused tests 覆盖 pin toggle、minimize、close。

## Spec Patch

无。当前 OpenSpec delta spec 已包含本轮已知验收场景。
