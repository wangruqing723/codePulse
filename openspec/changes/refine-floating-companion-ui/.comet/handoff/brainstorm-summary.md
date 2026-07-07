# Brainstorm Summary

- Change: refine-floating-companion-ui
- Date: 2026-07-07

## 确认的技术方案

采用现有边界内的紧凑 UI 重构方案。`main.ts` 负责同步 Electron always-on-top 状态到 view model；`view-model.ts` 负责状态汇总、置顶状态、上下文文案和路径展示数据；`renderer.tsx` 负责 Header、窗口按钮、会话卡片和复制交互 DOM；`styles.css` 负责深色模式视觉层级、紧凑两行卡片、状态点、hover 和复制成功动画。

## 关键取舍与风险

- 推荐方案保持现有模块边界，不新增依赖，风险最低。
- 备选方案 A：把状态汇总和置顶状态计算留在 renderer，代码改动更少，但状态规则分散且更难测试。
- 备选方案 B：抽出独立 UI component/helpers，长期可维护性更强，但对当前小型 companion renderer 来说会增加结构成本。
- 风险：紧凑布局可能挤压长标题和路径；通过 `min-width: 0`、ellipsis、固定图标按钮尺寸和列表防拉伸样式缓解。
- 风险：剪贴板 API 在部分环境不可用；通过 Electron bridge fallback 缓解。

## 测试策略

- View model 单测覆盖状态汇总、四类状态映射、上下文去重、错误/等待原因和路径展示。
- Renderer 单测覆盖 Header 汇总、置顶 active/inactive、无 drag handle、两行卡片、复制按钮 DOM、图标点击命中、clipboard 写入和成功反馈。
- Main 单测覆盖切换置顶后立即发布 `isPinned`。
- CSS 断言覆盖无固定高度/无 flex 拉伸、垂直居中、hover 反馈、图标 `pointer-events: none` 和复制动画。
- 运行 `npm test`、`npm run lint`、`npm run build`、`npm run companion:build`、`git diff --check`。

## Spec Patch

无新增候选。当前 OpenSpec delta 已覆盖 Header 汇总不折行、置顶视觉状态、图标按钮点击、复制反馈、两行自然高度卡片和只读约束。
