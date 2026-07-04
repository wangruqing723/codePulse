## Why

CodePulse 当前默认 Claude Code 和 Codex CLI 会话与 Raycast menu-bar 扩展运行在同一个 macOS 文件系统中。Windows 用户把两个 CLI 安装在 WSL2 内后，仍需要一个显眼、实时、低操作成本的会话状态入口。

用户进一步确认：旧的状态区入口不够显眼，因为任务栏程序图标只能说明应用在运行，不能直接展示“轮到我了 / 正在运行 / 需要处理”的会话状态。因此本阶段主入口改为 Electron 悬浮窗，并同步纳入 macOS；macOS 现有 Raycast menu-bar、Setup、hook 安装和文件扫描行为必须保持不变。

## What Changes

- 新增跨平台 Electron 悬浮窗 companion，支持 Windows 和 macOS。
- 悬浮窗默认置顶，实时用文字展示聚合会话状态和会话数量。
- 悬浮窗支持最小化/隐藏按钮。
- 悬浮窗支持贴边隐藏大半部分，鼠标移入展开，鼠标移开再次隐藏。
- 保留现有 macOS Raycast menu-bar command、Setup Hooks 和本机 transcript 文件扫描，不改变 macOS 既有体验。
- Windows companion 通过 `\\wsl$` 从默认 WSL2 发行版读取 Claude Code 和 Codex CLI transcript。
- Windows/WSL hook 或 notify 脚本把 CodePulse 事件写入 WSL 文件系统，再由 companion 读取。
- 会话动作第一阶段只做复制路径：Windows 支持复制 WSL 路径和 Windows UNC 路径，macOS 支持复制本机路径。
- 核心悬浮窗流程可用后，再补充基础 Electron 打包。
- 本次不实现 Windows Terminal 聚焦/打开，也不支持多个 WSL2 发行版。

## Capabilities

### New Capabilities
- `wsl2-monitoring`: 监控默认 WSL2 发行版内运行的 Claude Code 和 Codex CLI 会话，并通过跨平台 Electron 悬浮窗 companion 展示状态。

### Modified Capabilities
- macOS 现有 CodePulse Raycast 能力保持兼容；新增悬浮窗 companion 不替代现有 menu-bar、Setup Hooks 或本机文件扫描。

## Impact

- 新增 Electron floating companion 应用和相关 package/build 配置。
- 扩展共享会话扫描与状态逻辑，支持本机 macOS roots、Windows WSL2 roots 和 Windows UNC 路径转换。
- 更新 hook 安装逻辑，支持 WSL-local 事件输出，同时保持 macOS Raycast supportPath events 不变。
- 新增 WSL2 路径转换、WSL 事件发现、悬浮窗 view model、贴边隐藏和共享状态行为测试。
- 完整手动验证需要 Windows + WSL2 环境；macOS Raycast 现有行为必须保持不变，并额外验证 macOS floating companion 可运行。
