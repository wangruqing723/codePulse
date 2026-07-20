# 悬浮窗 QuotaDot 风格改造设计

## 背景

参考开源项目 [MeowkingCP/QuotaDot](https://github.com/MeowkingCP/QuotaDot)（Swift 6 + SwiftUI 原生菜单栏配额挂件）的**视觉与交互形态**，把 CodePulse 现有的 Electron 悬浮窗（companion）改造成同款观感：

- 收起时是一枚紧凑徽章（**主导状态色环 + 活跃会话总数**）。
- 悬停时展开成统一的会话详情面板。
- 磨砂玻璃质感（Liquid Glass），而非当前的 `#111827` 实底。
- 收起 ↔ 展开之间有过渡动效。

**只借鉴样式，不借鉴技术栈**：继续用现有的 TypeScript + Electron，不重写为 Swift。
**数据完全复用**现有会话状态（`FloatingViewModel`），不涉及任何配额数据。

## 范围与非目标

### 目标
- 悬浮窗在 macOS 上启用原生 vibrancy（真磨砂），透明圆角无边框。
- 收起态从「同尺寸窗口滑出屏幕只留一条缝」改为「窗口缩成一枚小徽章贴边」。
- 徽章展示主导状态色环 + 活跃会话总数；hover 展开为现有会话列表面板。
- 收起 ↔ 展开有平滑过渡（尺寸 + 透明度）。

### 非目标
- 不改菜单栏（Raycast menu-bar）——已与用户确认保持不动。
- 不删除 Windows/WSL 代码路径。vibrancy 是 mac-only 能力，`win32` 下自动回退到现有 CSS 观感，Windows 分支逻辑保持不变。
- 不引入配额数据、不接任何外部端点。
- 不改 `state.ts` / 扫描 / hook 相关逻辑。
- 不改 companion 的下载/校验/发布链路（`dist-companion`、GitHub Actions）。

## 现状回顾（改造落点）

| 关注点 | 现状 | 文件 |
|--------|------|------|
| 窗口构造 | `frame:false` + `backgroundColor:"#111827"`，固定宽 340（min=max），无 vibrancy | `src/companion/main.ts:559` |
| 收起机制 | 同尺寸窗口平移出屏，露出 `VISIBLE_SLIVER_PX=28`（`hiddenBounds`） | `main.ts:325`、`geometry.ts:87` |
| 展开机制 | `revealDockedWindow` 把窗口平移回原位 | `main.ts:298` |
| 悬停意图 | renderer `mouseenter/leave` → `hover-enter/leave` → reveal/hide | `renderer.tsx:414`、`main.ts:509` |
| 渲染 | 一套 DOM：header + 会话列表 / 空状态 | `renderer.tsx:282` |
| 状态色 | green/blue/red/yellow 四 tone，`summaryItems` 已含各状态计数 | `view-model.ts:68`、`styles.css:3` |
| 背景 | `#111827` 实底 | `styles.css:17` |

关键点：现有「收起」是**位置平移**（窗口尺寸不变），要改成的 QuotaDot 徽章是**尺寸收缩**（小窗口）。这是本次改造的核心几何变化。

## 方案抉择

### 收起徽章的实现形态

**方案 A（采用）：窗口真收缩成小徽章。**
放开当前锁死的 `minWidth=maxWidth=340`，收起时把窗口 `setBounds` 到徽章尺寸（如 `120×44` 胶囊，容纳「色环 + 总数」），贴在停靠边；展开时恢复到 full 尺寸（340 × 自适应高度）。renderer 依据 `collapsed/expanded` 标志渲染两套视图。
- 优点：与 QuotaDot 形态一致，收起后不占屏。
- 代价：需为「徽章尺寸」新增几何计算，并与现有 `fullBounds/hidden` 状态机整合。

**方案 B（不采用）：窗口尺寸不变，仅内容缩成小徽章。**
窗口仍 340 宽，收起时只渲染角落一个小徽章、其余透明。vibrancy 作用于整窗，会留下一大片磨砂空区，观感不对，弃用。

### collapsed/expanded 状态如何传给 renderer

现有 `hover-enter/leave` 已经在 main 端驱动 reveal/hide。扩展这条链路：main 端在 reveal/hide 时，除了改窗口 bounds，还通过 `view-model` 广播一个 `presentation: "badge" | "panel"` 字段，renderer 据此切换 DOM。收起/展开的**权威状态在 main 端**，renderer 只做渲染。

### vibrancy 与透明

`darwin` 下窗口构造改为 `transparent:true` + `vibrancy:"hud"`（或 `"under-window"`，实现时二选一试观感）+ `backgroundColor` 设为透明。`win32` 保持 `backgroundColor:"#111827"` 不变。CSS 里 `body` 背景改为透明，由 vibrancy 提供底色；`.shell` 加圆角 + 半透明叠加层。

## 数据模型改动

`view-model.ts` 的 `FloatingViewModel` 增补（不改现有字段）：

```ts
type CompanionPresentation = "badge" | "panel";

interface FloatingBadgeViewModel {
  tone: StatusTone;        // 主导状态色
  status: FloatingStatus;  // 主导状态
  totalCount: number;      // 活跃会话总数（running+waiting+done+error，排除 idle）
  label: string;           // 备用无障碍文案，如 "3 个活跃会话"
}

interface FloatingViewModel {
  // ...现有字段保持不变
  presentation?: CompanionPresentation; // 默认 "panel"；由 main 端在 reveal/hide 时设置
  badge?: FloatingBadgeViewModel;        // 收起徽章数据，纯从现有 snapshot 推导
}
```

`badge` 数据完全从现有 `sessions/summaryItems` 推导：主导状态沿用 `dominantStatus` 顺序（error > waiting > running > done），tone 沿用 `STATUS_TONE`，总数为非 idle 会话数。

## 几何改动（geometry.ts）

新增纯函数（保持可测试，无副作用）：

```
badgeBounds(fullBounds, workArea, edge, badgeSize): Rect
  // 把窗口收缩到 badgeSize 并贴在 edge 上（沿边对齐，另一轴取靠边锚点）

// 展开时复用现有 resizeToHeight / dockWindow 回到 fullBounds
```

收起不再用 `hiddenBounds`（平移出屏），改用 `badgeBounds`（收缩贴边）。`hiddenBounds` 可保留给 Windows 回退或后续删除，本次不动其调用点以外的逻辑——由 TASKS 明确。

## 过渡动效

- **窗口尺寸过渡**：Electron `setBounds` 无内建动画。可用 renderer 侧 CSS 承接视觉过渡（`.shell` 的 opacity/transform），窗口 bounds 一次性切换；或 main 端分帧 `setBounds` 做尺寸缓动（成本高，先做 CSS 版）。
- **DOM 切换过渡**：badge ↔ panel 用 CSS `transition` + opacity/scale，避免硬切。

## 风险

- 透明 + vibrancy 窗口在 resize 时可能有边缘闪烁；`hasShadow`、圆角与透明的组合需实测。
- 徽章尺寸下 `reportContentHeight` 的自适应高度逻辑需短路（徽章尺寸固定，不参与内容测高）。
- 现有大量 `main.test.ts / geometry.test.ts / renderer.test.ts / view-model.test.ts` 需同步更新，避免回归。

## 验证

- `npm run build`、`npm run lint`、`npm test` 全绿。
- 手动：dev 下启动 companion，验证磨砂观感、贴边收起成徽章、hover 展开、色环随主导状态变色、总数正确。
