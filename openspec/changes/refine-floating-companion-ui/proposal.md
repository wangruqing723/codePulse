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
