# Brainstorm Summary

- Change: wsl2-monitoring
- Date: 2026-07-03
- Status: 用户已确认范围变更

## 已确认事实

- Windows 版需要显眼、实时、低操作成本的状态入口。
- Raycast for Windows 支持扩展，但不支持 `menu-bar` command。
- 旧状态区入口不再作为本阶段主入口，因为它不能直接展示实时会话文字状态。
- 本阶段主入口改为 Electron 悬浮窗 companion。
- 悬浮窗纳入 Windows 和 macOS 两个平台。
- 悬浮窗默认置顶。
- 悬浮窗提供最小化/隐藏按钮。
- 悬浮窗支持贴边隐藏大半部分，鼠标移入展开，鼠标移开再次隐藏。
- Claude Code 和 Codex CLI 安装在同一个默认 WSL2 发行版内。
- Windows 会话动作第一阶段只做复制路径：WSL 路径和 Windows UNC 路径。
- macOS floating companion 会话动作第一阶段复制本机路径。
- Windows Terminal 打开或聚焦不在本阶段。
- Electron companion 可以接受。
- Electron 打包纳入本阶段，但排在核心功能之后。
- Raycast 扩展和 Electron companion 各自管理生命周期。
- hook 事件先写入 WSL 内部，再由 Windows companion 读取。
- macOS 现有 Raycast menu-bar、Setup Hooks、supportPath events 和本机 transcript 文件扫描必须保持不变。

## 推荐方案

采用共享 TypeScript 状态核心 + 跨平台 Electron floating companion。macOS Raycast menu-bar 保持现状；Windows/macOS companion 独立运行悬浮窗。Windows 侧读取默认 WSL2 distro 中的 Claude/Codex transcript 和 WSL-local CodePulse events；macOS companion 使用本机 transcript 扫描，不改写 Raycast supportPath 或 Setup 行为。

## 关键取舍与风险

- Electron 增加依赖和包体积，但只影响新增 companion，不替代 Raycast 扩展。
- 贴边隐藏涉及多显示器、高 DPI、任务栏/Dock，需要把窗口几何逻辑抽成纯函数测试并手动验证。
- always-on-top 可能打扰工作流，因此提供隐藏/最小化按钮。
- `\\wsl$` 访问可能慢或不可用，需要 companion 显示不可用状态并不中断刷新循环。
- 默认 WSL2 distro 可能与实际 CLI 所在 distro 不一致，本阶段通过健康检查或错误态暴露默认 distro 信息，不做多 distro 选择。
- WSL-local events 与 transcript 被动扫描可能冲突，需要沿用现有 freshness/debounce 规则并补测试。

## 测试策略

- 为 WSL path 到 UNC path 转换、默认 distro 解析、monitor prefix 匹配添加单元测试。
- 为 Claude/Codex 扫描 root 配置化添加测试，确保 macOS 默认路径不回退。
- 为 WSL-local events 读取和 `mergeHookEvents` 合并路径添加测试。
- 为 floating companion 的状态 view model、窗口几何、贴边隐藏和路径动作添加纯函数测试。
- 手动验证 macOS Raycast menu-bar 仍可刷新和安装 hooks。
- 手动验证 Windows + WSL2 悬浮窗启动、状态刷新、贴边隐藏、会话列表、复制 WSL 路径和复制 UNC 路径。
- 手动验证 macOS 悬浮窗启动、状态刷新、贴边隐藏和复制本机路径。

## Spec Patch

回写 OpenSpec delta spec：将旧 Windows 状态区 companion 改为跨平台 Electron 悬浮窗 companion；新增 always-on-top、隐藏/最小化、贴边隐藏、hover 展开、macOS 现有行为保持不变和 macOS 本机路径复制场景。
