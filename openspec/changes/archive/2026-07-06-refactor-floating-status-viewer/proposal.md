## Why

Electron Floating Companion 当前混合了状态查看和恢复/控制入口，右上角图标表意不够清楚，单个会话卡片的信息层级也偏重。用户希望它成为一个深色模式下的纯状态查看器：一眼看清进程状态、路径和必要上下文，同时不提供终止进程、打开终端等控制操作。

## What Changes

- 将悬浮窗头部控制区重构为 `Pin`、`Minimize`、`Close` 三个标准桌面图标按钮，并移除悬浮窗内可见的强制退出/终止进程入口。
- 将全局状态文案从单一 dominant 文案升级为状态聚合摘要，优先突出错误，也可展示运行、错误、等待、完成的数字汇总。
- 将卡片状态视觉压到四类：运行中为绿色、已完成为蓝色、错误为红色、等待确认为黄色。
- 用状态圆点和运行中 pulse 动画替代卡片顶部的纯文本状态；错误卡片用轻微红色边框提示。
- 重排卡片信息层级：标题和状态更清楚，路径中间截断并保留完整路径 tooltip，复制路径成为路径行右侧的唯一操作。
- 在路径下方展示只读上下文：错误摘要、等待原因或更新时间语境，并在右下角预留/展示进程存活时长。
- Windows/WSL 场景下每张卡片仅保留一个复制路径动作，优先复制 `\\wsl$...` UNC 路径，缺失时回退 WSL 路径。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wsl2-monitoring`: Floating Companion 的状态窗、窗口控制、状态色、路径复制和会话卡片只读展示行为发生变化。

## Impact

- Affected code: `src/companion/renderer.tsx`, `src/companion/styles.css`, `src/companion/view-model.ts`, `src/companion/preload.ts`, `src/companion/main.ts`, and focused companion tests.
- Affected specs: `openspec/specs/wsl2-monitoring/spec.md` via delta spec.
- No new runtime dependency is expected.
- Raycast Center 的 companion recovery 入口不在本 change 中移除；本 change 只移除悬浮窗内的控制/恢复入口。
