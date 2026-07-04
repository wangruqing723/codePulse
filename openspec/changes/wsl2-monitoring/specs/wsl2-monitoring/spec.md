## ADDED Requirements

### Requirement: 跨平台悬浮窗状态 companion
系统 SHALL 提供一个 Electron floating companion，在 Windows 和 macOS 上以悬浮窗形式运行，并在用户不打开 Raycast command 的情况下用文字展示最紧急的 CodePulse 会话状态。

#### Scenario: 悬浮窗展示等待状态文字
- **WHEN** 至少一个受监控的 Claude Code 或 Codex CLI 会话正在等待用户输入或授权
- **THEN** 悬浮窗展示明确文字状态和等待会话数量，例如 `轮到你了 2 个`

#### Scenario: 悬浮窗展示运行状态文字
- **WHEN** 没有会话等待用户，并且至少一个受监控会话正在运行
- **THEN** 悬浮窗展示明确文字状态和运行会话数量，例如 `运行中 1 个`

#### Scenario: 悬浮窗默认置顶
- **WHEN** floating companion 启动
- **THEN** 悬浮窗默认以 always-on-top 方式显示在其他普通窗口之上

#### Scenario: 用户隐藏或最小化悬浮窗
- **WHEN** 用户点击悬浮窗的隐藏或最小化控件
- **THEN** companion 隐藏或最小化悬浮窗，且不停止后台状态刷新

#### Scenario: 贴边后自动隐藏大半部分
- **WHEN** 用户将悬浮窗拖到屏幕边缘并移开鼠标
- **THEN** 悬浮窗自动隐藏大半部分，只保留可见状态边栏

#### Scenario: 鼠标移入贴边窗口后展开
- **WHEN** 悬浮窗处于贴边隐藏状态且鼠标移动到可见区域
- **THEN** 悬浮窗展开为完整窗口

#### Scenario: 鼠标移开后再次贴边隐藏
- **WHEN** 贴边悬浮窗已展开且鼠标移出窗口区域
- **THEN** 悬浮窗再次隐藏大半部分

#### Scenario: 开发模式首次启动保持可交互
- **WHEN** 维护者第一次运行 `npm run companion:dev` 启动 floating companion
- **THEN** 悬浮窗不会进入不可点击、不可触发 hover 的贴边隐藏状态
- **AND** 不需要关闭终端后第二次运行命令才能恢复正常交互

### Requirement: 默认 WSL2 transcript 扫描
系统 SHALL 使用 Windows 可访问的 WSL 路径，从用户默认 WSL2 发行版扫描 Claude Code 和 Codex CLI transcript。

#### Scenario: 在 WSL 中发现 Claude transcript
- **WHEN** Claude Code 在默认 WSL2 发行版内的 `~/.claude/projects` 写入 JSONL transcript
- **THEN** Windows companion 将匹配的近期 Claude 会话纳入会话状态

#### Scenario: 在 WSL 中发现 Codex transcript
- **WHEN** Codex CLI 在默认 WSL2 发行版内的 `~/.codex/sessions` 写入 JSONL transcript
- **THEN** Windows companion 将匹配的近期 Codex 会话纳入会话状态

#### Scenario: WSL 不可用
- **WHEN** 默认 WSL2 发行版无法解析或其文件无法读取
- **THEN** Windows companion 在悬浮窗中报告监控不可用状态且不崩溃

### Requirement: WSL-local hook 事件摄取
系统 SHALL 在 WSL 内安装 hook 或 notify 脚本，并把 CodePulse 事件写入由 Windows companion 读取的 WSL-local 事件目录。

#### Scenario: Claude hook 事件写入 WSL
- **WHEN** 已配置的 Claude Code hook 在 WSL 内触发
- **THEN** hook 脚本在 WSL-local CodePulse events 目录下写入 CodePulse 事件文件

#### Scenario: Codex notify 事件写入 WSL
- **WHEN** Codex CLI 在 WSL 内调用已配置的 notify 命令
- **THEN** notify 脚本在 WSL-local CodePulse events 目录下写入 CodePulse 事件文件

#### Scenario: Windows companion 合并 WSL 事件
- **WHEN** 近期会话存在 WSL-local CodePulse 事件文件
- **THEN** Windows companion 将这些事件与被动 transcript 扫描结果合并，以提升 waiting 和 done 状态准确性

### Requirement: 路径复制动作
系统 SHALL 允许用户从悬浮窗会话列表复制受监控会话路径。

#### Scenario: Windows 复制 WSL 路径
- **WHEN** Windows 用户对 cwd 为 `/home/user/project` 的会话选择复制 WSL 路径动作
- **THEN** 剪贴板收到 `/home/user/project`

#### Scenario: Windows 复制 UNC 路径
- **WHEN** Windows 用户对默认发行版名为 `Ubuntu` 且 cwd 为 `/home/user/project` 的会话选择复制 Windows 路径动作
- **THEN** 剪贴板收到 `\\wsl$\Ubuntu\home\user\project`

#### Scenario: macOS 复制本机路径
- **WHEN** macOS 用户对 cwd 为 `/Users/me/project` 的会话选择复制路径动作
- **THEN** 剪贴板收到 `/Users/me/project`

### Requirement: macOS 现有行为保持不变
系统 SHALL 在新增 macOS floating companion 的同时保持现有 Raycast menu-bar、Setup Hooks、hook events 和本机 transcript 文件扫描行为不回退。

#### Scenario: Raycast menu-bar 继续刷新
- **WHEN** macOS 用户继续使用现有 CodePulse Raycast menu-bar command
- **THEN** menu-bar 仍按现有偏好和本机 transcript 文件扫描结果刷新状态

#### Scenario: Codex CLI subagent 不重置父会话运行状态
- **WHEN** Codex CLI 父会话仍在运行，且同项目下存在 Codex subagent transcript 或状态更新
- **THEN** menu-bar 继续保留父会话的 `运行中` 状态，直到收到明确的 waiting、done、error 或父会话结束证据
- **AND** subagent 活动不会把父会话错误重置为非运行状态

#### Scenario: Raycast Setup Hooks 继续写入原位置
- **WHEN** macOS 用户通过现有 Setup Hooks 安装或更新 hooks
- **THEN** hook 脚本继续写入 Raycast supportPath events，不被 floating companion 改写为其他默认目录

#### Scenario: macOS floating companion 不替代 Raycast
- **WHEN** macOS floating companion 启动或退出
- **THEN** Raycast menu-bar command 和 Setup Hooks 不被启动、停止、卸载或重配置

### Requirement: 基础跨平台 companion 打包
系统 SHALL 在核心悬浮窗监控流程可用后，提供 Electron companion 的基础打包路径。

#### Scenario: 打包命令构建 companion
- **WHEN** 维护者运行文档化的 companion package 命令
- **THEN** 项目产出本地可安装或可运行的 Windows 和 macOS companion artifact，或在当前平台不支持交叉打包时明确记录需在目标平台执行

#### Scenario: 打包不阻塞核心开发
- **WHEN** 悬浮窗监控流程在打包完成前进行开发或测试
- **THEN** companion 仍可通过开发模式运行以完成核心功能验证
