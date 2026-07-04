## Context

CodePulse 当前是 Raycast 扩展，主入口是 macOS `menu-bar` command。核心逻辑已经拆在 `src/lib` 中，包括 Claude/Codex JSONL 扫描、状态推断、hook 事件合并、通知和 iTerm2 聚焦。Windows 目标场景不同：Claude Code 和 Codex CLI 都运行在同一个默认 WSL2 发行版内，而 Raycast for Windows 不支持 `menu-bar` command。

最初方案使用 Windows 状态区 companion，但用户进一步确认该入口不够显眼：任务栏图标只能说明程序运行，不能实时展示会话状态。新方向是跨平台 Electron 悬浮窗 companion。悬浮窗直接用文字展示“轮到你了 / 运行中 / 无近期会话 / WSL 不可用”等状态，并支持贴边隐藏与鼠标 hover 展开。

macOS 现有 Raycast menu-bar、Setup Hooks 和本机文件扫描是已可用能力，本阶段不得破坏。macOS 悬浮窗作为新增 companion，与 Raycast 入口并行存在。

## Goals / Non-Goals

**Goals:**

- 在 Windows 和 macOS 提供 Electron 悬浮窗 companion，实时展示最紧急的 Claude/Codex 会话状态。
- 悬浮窗默认置顶，提供最小化/隐藏按钮。
- 悬浮窗支持贴边隐藏大半部分，鼠标移入展开，鼠标移开再次隐藏。
- 提供 companion 卡死场景的一键恢复能力，CLI、Raycast 和悬浮窗内入口复用同一套恢复逻辑。
- 从默认 WSL2 发行版读取 `~/.claude/projects`、`~/.codex/sessions` 和 WSL-local CodePulse events。
- 复用现有 TypeScript 状态推断逻辑，避免 macOS、Windows、Raycast 与 companion 维护多套判定规则。
- Windows 会话支持复制 WSL 路径和 Windows UNC 路径；macOS 会话支持复制本机路径。
- 核心功能完成后，提供基础 Electron 打包路径。
- 保持现有 macOS Raycast menu-bar、Setup Hooks、hook 事件目录和本机文件扫描行为不回退。

**Non-Goals:**

- 本阶段不实现 Windows Terminal 打开或聚焦。
- 本阶段不支持多个 WSL2 发行版。
- 本阶段不做自动更新、代码签名、复杂安装器定制或开机自启。
- 本阶段不让 Raycast 扩展承担 companion 的正常启动/停止管理。
- 本阶段不移除或替换 macOS Raycast menu-bar。

## Decisions

1. 主入口改为 Electron floating `BrowserWindow`

Electron 能同时覆盖 Windows 和 macOS，适合实现常驻置顶、无边框或轻边框小窗、跨平台剪贴板、窗口位置持久化、贴边隐藏和 hover 展开。悬浮窗更直接满足“显眼、实时、少操作”的需求。

2. Raycast 与 companion 并行存在

Raycast 继续负责 macOS menu-bar、Setup Hooks、通知和已有 iTerm2 行为。Electron companion 负责悬浮窗、跨平台状态展示、窗口交互、路径复制和基础打包。两者调用共享状态核心，但生命周期互不管理。

3. 共享状态核心继续平台无关

抽象扫描 root、event root 和 state root。macOS Raycast 默认继续使用本机 home 与 Raycast `supportPath/events`。macOS companion 默认读取本机 Claude/Codex transcript，并使用 companion 自己的 state root；如后续需要读取 Raycast hook events，应通过显式配置接入，不在本阶段改写 Raycast supportPath。Windows companion 使用 WSL UNC roots 和 WSL-local events。

4. WSL 事件先写入 WSL 内部

Claude/Codex hook 在 WSL 内执行，所以脚本应写入 WSL-local 目录，例如 `~/.codepulse/events`。Windows companion 再通过 `\\wsl$\<distro>\home\<user>\.codepulse\events` 读取。这样不要求 WSL 脚本知道 Windows app data 或 companion 安装路径。

5. 第一阶段只支持默认 WSL2 发行版

用户已确认 Claude Code 和 Codex CLI 在同一个默认 WSL2 发行版内。实现上通过 `wsl.exe` 或等价探测拿到默认发行版名，并把 WSL path 转换为 `\\wsl$\<distro>\home\<user>\project`。多发行版选择留到后续。

6. 打包纳入本阶段但排在最后

先完成开发模式下可运行的悬浮窗 companion，再补基础打包命令。打包不应阻塞扫描、状态展示、路径复制和窗口交互这些核心功能。

7. 增加共享 companion 进程控制层

companion 的恢复动作不能分别在 CLI、Raycast 和悬浮窗里各写一套。应新增共享的进程控制层，统一负责登记当前 companion 进程、读取最近记录、清理 stale 记录，以及按平台执行恢复型 kill。恢复逻辑优先按登记主进程 pid 清理整棵 companion 进程树；记录失效时，再按已登记的可执行路径和入口参数做兜底扫描，避免误伤其他 Electron 应用。

8. Raycast Setup 页面改名为 CodePulse Center

Raycast 现有 `setup-hooks` command slug 保持不变，避免打断现有 deeplink。展示标题、说明文案和页面定位更新为 `CodePulse Center`，职责改为“配置 + 恢复控制台”：继续负责 hook 配置和健康检查，同时允许提供 companion 故障恢复入口，但不负责正常生命周期管理。

## Risks / Trade-offs

- [Risk] 贴边隐藏窗口在多显示器、高 DPI、任务栏/Dock 区域下行为复杂 -> 将窗口几何逻辑抽成纯函数测试，并手动验证 Windows 与 macOS。
- [Risk] always-on-top 可能打扰工作流 -> 提供隐藏/最小化按钮，保留后续偏好项空间。
- [Risk] `\\wsl$` 访问慢或 WSL 未启动时读取失败 -> companion 要显示不可用状态，并避免刷新循环抛错退出。
- [Risk] Electron 增加依赖和包体积 -> 用于新增 companion；macOS Raycast extension 保持现有构建路径。
- [Risk] 默认 WSL distro 与实际 CLI 所在 distro 不一致 -> MVP 明确只支持默认 distro，并在健康检查或悬浮窗错误态中暴露检测结果。
- [Risk] hook 事件和 passive transcript 状态冲突 -> 继续沿用现有事件 freshness 和 debounce 规则，并为 WSL event path 增加测试。
- [Risk] 恢复动作误伤其他 Electron 应用 -> kill 逻辑必须优先依赖 companion 自身登记的 pid、execPath 和入口参数，只允许清理匹配 CodePulse companion 特征的进程树。
- [Risk] `npm run companion:dev` 首次启动可能从持久化 geometry 进入不可点击、不可 hover 的贴边隐藏状态 -> 后续修复需优先排查 geometry 恢复、窗口 ready/show 时序和 hover hit-test 状态，不把“第二次启动正常”当作已验证通过。

## Migration Plan

1. 抽象共享扫描入口，使 macOS home 扫描和 Windows WSL UNC 扫描都调用同一套状态推断函数。
2. 新增 WSL2 路径解析与默认 distro 探测模块。
3. 新增 Electron floating companion，先用开发模式运行悬浮窗状态展示。
4. 实现 always-on-top、隐藏/最小化、贴边隐藏、hover 展开和窗口位置持久化。
5. 调整 hook 安装逻辑，使 Windows/WSL 路径下的事件写入 WSL-local events，同时保持 macOS Raycast hook 行为不变。
6. 新增共享 companion 进程控制层，并把 CLI、Raycast 和悬浮窗内恢复动作接到同一实现。
7. 将 Raycast Setup 页面重命名为 CodePulse Center，并补充恢复动作。
8. 补充基础打包脚本和文档。

Rollback 策略：如果 floating companion 功能不完整，macOS Raycast extension 仍保持现有行为；新 companion 可以不发布或不打包。

## Open Questions

- 悬浮窗是否需要开机自启，若需要后续作为独立增强处理。
- 悬浮窗样式主题是否需要跟随系统深浅色，若本阶段时间不足，可先使用简洁固定主题。
