# TASKS — 悬浮窗 QuotaDot 风格改造

> 状态：✅ 已完成并验收（2026-07-20）。build / lint / test 310 passed；dev 手测通过。
> 格式：`[ ] 任务名 | 优先级 | 估时 | 依赖`
> 只改 macOS 观感与收起形态，数据复用现有会话状态。Windows/WSL 分支不动。

## P0 — 数据与几何基础

- [x] T1 view-model 增补 badge 数据 | P0 | 1h | 无
  - 文件：`src/companion/view-model.ts`
  - 在 `FloatingViewModel` 增补 `presentation?: "badge" | "panel"`（默认 panel）与 `badge?: FloatingBadgeViewModel`。
  - 新增导出纯函数 `buildBadgeViewModel(snapshot, context)`：主导状态用现有 `dominantStatus` 顺序，tone 用 `STATUS_TONE`，totalCount = 非 idle 会话数。
  - `buildFloatingViewModel` 里填充 `badge` 字段；`presentation` 不在此设默认由渲染兜底为 "panel"。
  - 验收：新增/更新 `view-model.test.ts` 覆盖各主导状态与空状态；`npm test` 绿。

- [x] T2 geometry 新增徽章边界计算 | P0 | 1.5h | 无
  - 文件：`src/companion/geometry.ts`
  - 新增导出纯函数 `badgeBounds(fullBounds, workArea, edge, badgeSize: {width,height}): Rect`：窗口收缩到 badgeSize 并沿 edge 贴边对齐（参考 `hiddenBounds`/`dockWindow` 的对齐写法）。
  - 不删除 `hiddenBounds`。
  - 验收：新增 `geometry.test.ts` 用例覆盖四条边贴边对齐；`npm test` 绿。

## P1 — 窗口与主进程

- [x] T3 窗口启用 vibrancy 与透明（mac-only） | P1 | 1h | 无
  - 文件：`src/companion/main.ts:559` `createMainWindow`
  - `darwin` 分支：`transparent:true` + `vibrancy:"hud"`（实测可换 `"under-window"`）+ 透明 backgroundColor；`win32` 保持 `backgroundColor:"#111827"`。
  - 放开 `minWidth/maxWidth` 锁死 340 的限制，改为允许收缩到徽章宽度（保留合理下限）。
  - 验收：dev 启动窗口为磨砂透明圆角；Windows 逻辑分支不变；`npm run build` 绿。

- [x] T4 收起改为徽章收缩、展开恢复 full | P1 | 2.5h | T2, T3
  - 文件：`src/companion/main.ts`（`hideDockedWindow`/`revealDockedWindow`/`dockToEdge` 一带）
  - 收起：用 `badgeBounds` 替代 `hiddenBounds`（darwin 走徽章；win32 可保留原 sliver 行为，二选一由实现注明）。
  - 展开：恢复到 `fullBounds`（复用 `resizeToHeight`/`dockWindow`）。
  - reveal/hide 时通过 `publishModel` 广播 `presentation: "panel"|"badge"`。
  - 徽章态下短路 `applyContentHeight`（不按内容测高改窗口）。
  - 验收：更新 `main.test.ts`；贴边收起成徽章、hover 展开还原；`npm test` 绿。

## P1 — 渲染与样式

- [x] T5 renderer 渲染 badge/panel 两态 | P1 | 2h | T1
  - 文件：`src/companion/renderer.tsx`
  - 依据 `model.presentation` 渲染：`badge` → 色环 + 总数的紧凑视图；`panel` → 现有 header + 会话列表。
  - 徽章态整体可点击/hover 触发展开（复用 `hover-enter`）。
  - 徽章态不调用 `reportContentHeight`（或上报固定徽章高度）。
  - 验收：更新 `renderer.test.ts` 覆盖两态渲染；`npm test` 绿。

- [x] T6 styles 磨砂玻璃 + 徽章样式 + 过渡 | P1 | 2h | T5
  - 文件：`src/companion/styles.css`
  - `body` 背景透明由 vibrancy 提供；`.shell` 加圆角 + 半透明叠加层（保证文字对比度）。
  - 新增 `.badge` 样式：色环（四 tone，running 复用 pulse 呼吸）+ 总数字。
  - badge ↔ panel 用 CSS transition（opacity/scale）过渡。
  - Windows 回退：无 vibrancy 时 `.shell` 保留近似 `#111827` 底，不破相。
  - 验收：dev 下观感符合；深浅背景下文字可读。

## P2 — 收尾

- [x] T7 全量验证与自测清单 | P2 | 1h | T1-T6
  - `npm run build` / `npm run lint` / `npm test` 全绿。
  - dev 手测：磨砂、贴边收起成徽章、hover 展开、色环变色、总数正确、pin/minimize/close/复制路径不回归。
  - 清理临时文件。

## 备注
- 不改菜单栏、不改发布链路、不引入配额数据。
- Windows/WSL 分支保持现状，vibrancy 仅 darwin 生效，win32 走 CSS 回退。
- 打过 release tag 的提交禁止 amend（见项目记忆）。
