# wsl2-monitoring Specification

## Purpose
TBD - created by archiving change wsl2-monitoring. Update Purpose after archive.
## Requirements
### Requirement: 跨平台悬浮窗状态 companion
系统 SHALL 提供一个 Electron floating companion，在 Windows 和 macOS 上以深色模式悬浮窗形式运行，并在用户不打开 Raycast command 的情况下展示 CodePulse 会话状态。该悬浮窗 SHALL 作为纯状态查看器，不在悬浮窗内提供终止进程、打开终端或启动/停止会话等控制操作。

#### Scenario: 悬浮窗展示聚合状态摘要
- **WHEN** 至少一个受监控的 Claude Code 或 Codex CLI 会话处于运行中、已完成、错误或等待确认状态
- **THEN** 悬浮窗头部展示这些状态的数字汇总
- **AND** 汇总仅使用运行中、已完成、错误和等待确认这四种状态
- **AND** 汇总项使用 12px 状态圆点与文本在同一行水平居中对齐
- **AND** 汇总文本不得折行

#### Scenario: 错误状态优先突出
- **WHEN** 至少一个受监控会话处于错误状态，且其他会话处于运行中、已完成或等待确认状态
- **THEN** 悬浮窗将错误作为最高优先级状态突出展示
- **AND** 仍可展示其他非零状态的数字汇总

#### Scenario: 悬浮窗默认置顶
- **WHEN** floating companion 启动
- **THEN** 悬浮窗默认以 always-on-top 方式显示在其他普通窗口之上
- **AND** 置顶控件展示白色垂直实心图钉和微弱白色激活背景

#### Scenario: 用户切换置顶
- **WHEN** 用户点击悬浮窗头部的置顶控件
- **THEN** companion 切换窗口 always-on-top 状态
- **AND** 不停止后台状态刷新
- **AND** 未置顶时置顶控件展示灰色倾斜空心图钉和透明背景
- **AND** 已置顶时置顶控件展示白色垂直实心图钉和微弱白色激活背景

#### Scenario: 用户最小化悬浮窗
- **WHEN** 用户点击悬浮窗头部的最小化控件
- **THEN** companion 最小化悬浮窗
- **AND** 不停止后台状态刷新

#### Scenario: 用户关闭悬浮窗
- **WHEN** 用户点击悬浮窗头部的关闭控件
- **THEN** companion 关闭悬浮窗进程
- **AND** 不对任何受监控 Claude Code 或 Codex CLI 进程执行终止操作

#### Scenario: 头部不展示无意义占位元素
- **WHEN** 悬浮窗 Header 渲染
- **THEN** Header 不展示暗色垂直条、圆角矩形占位符或其他无语义拖拽装饰

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
系统 SHALL 允许用户从悬浮窗会话列表复制受监控会话路径。每个会话卡片 SHALL 仅展示一个复制路径动作。

#### Scenario: Windows 优先复制 UNC 路径
- **WHEN** Windows 用户对默认发行版名为 `Ubuntu` 且 cwd 为 `/home/user/project` 的会话选择复制路径动作
- **THEN** 剪贴板收到 `\\wsl$\Ubuntu\home\user\project`

#### Scenario: Windows UNC 不可用时回退 WSL 路径
- **WHEN** Windows 用户对 cwd 为 `/home/user/project` 的会话选择复制路径动作
- **AND** companion 无法为该会话生成 UNC 路径
- **THEN** 剪贴板收到 `/home/user/project`

#### Scenario: macOS 复制本机路径
- **WHEN** macOS 用户对 cwd 为 `/Users/me/project` 的会话选择复制路径动作
- **THEN** 剪贴板收到 `/Users/me/project`

#### Scenario: 复制按钮写入路径并展示反馈
- **WHEN** 用户点击会话卡片路径行最右侧的复制图标按钮
- **THEN** companion 使用可用剪贴板 API 写入该会话路径
- **AND** 复制按钮展示短暂成功反馈动画
- **AND** 卡片不展示除复制路径以外的其他操作

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

### Requirement: Floating companion 图标按钮交互
系统 SHALL 在窗口操作按钮或复制路径按钮使用图标化内容时，仍正确处理用户对按钮内部图标元素的点击。窗口操作按钮 SHALL 仅包含置顶、最小化和关闭。

#### Scenario: 点击置顶图标内部元素
- **WHEN** 用户点击置顶按钮内部的图标元素
- **THEN** companion 触发 `pin` 窗口动作

#### Scenario: 点击最小化图标内部元素
- **WHEN** 用户点击最小化按钮内部的图标元素
- **THEN** companion 触发 `minimize` 窗口动作

#### Scenario: 点击关闭图标内部元素
- **WHEN** 用户点击关闭按钮内部的图标元素
- **THEN** companion 触发 `close` 窗口动作

#### Scenario: 点击复制图标内部元素
- **WHEN** 用户点击复制路径按钮内部的图标元素
- **THEN** companion 触发该卡片的复制路径动作

#### Scenario: 图标按钮展示 hover 反馈
- **WHEN** 用户将鼠标悬停在窗口操作按钮或复制路径按钮上
- **THEN** 按钮背景展示轻微高亮反馈

### Requirement: Companion 共享 Raycast 监控偏好
系统 SHALL 让 Electron floating companion 使用 Raycast 中配置的监控窗口和项目过滤偏好，并在配置快照不可用时保留安全兜底。

#### Scenario: 使用 Raycast 监控窗口分钟数
- **WHEN** Raycast 配置的 `activeWindowMinutes` 为 `30`
- **THEN** companion 扫描和事件合并使用 30 分钟作为活跃窗口

#### Scenario: 使用 Raycast 项目过滤
- **WHEN** Raycast 配置的 `monitorProjects` 包含项目路径前缀
- **THEN** companion 使用同一项目路径前缀过滤受监控会话

#### Scenario: 偏好快照不可用时使用兜底
- **WHEN** companion 无法读取 Raycast 偏好快照
- **THEN** companion 使用环境变量配置；若环境变量也不存在，则使用默认 5 分钟监控窗口

### Requirement: Raycast 管理 Floating Companion bootstrap
系统 SHALL 允许用户通过 CodePulse Center 安装并启动 Electron Floating Companion，而不要求用户手动下载、复制或安装 companion `.app` / `.exe`。

#### Scenario: 已安装 companion 时直接启动
- **WHEN** `environment.supportPath` 中存在当前版本和平台匹配的 companion artifact
- **THEN** CodePulse Center 的启动动作直接打开该本地 artifact
- **AND** 不重新下载 artifact

#### Scenario: public GitHub Release 首次安装
- **WHEN** 当前仓库已转为 public
- **AND** 当前平台存在匹配的 companion release artifact
- **THEN** CodePulse Center 通过公共 GitHub Release URL 下载 manifest 和对应平台 zip
- **AND** 使用 SHA-256 校验下载内容
- **AND** 校验通过后解压到 `environment.supportPath` 下的版本化 companion 目录
- **AND** 启动解压后的 companion artifact

#### Scenario: public release unavailable
- **WHEN** 本地未安装 companion artifact
- **AND** public GitHub Release URL 不可访问或对应 artifact 不存在
- **THEN** CodePulse Center 显示 release artifact 不可用的失败提示
- **AND** 不修改已有 companion 安装

#### Scenario: artifact hash mismatch
- **WHEN** companion zip 下载完成
- **AND** zip 的 SHA-256 与 manifest 中声明的值不一致
- **THEN** 系统删除该下载文件
- **AND** 显示校验失败提示
- **AND** 不解压或启动该 artifact

#### Scenario: unsupported platform
- **WHEN** 当前 `process.platform` 和 `process.arch` 没有匹配的 companion artifact
- **THEN** CodePulse Center 显示当前平台暂不支持 Floating Companion bootstrap
- **AND** 不修改已有 companion 安装

#### Scenario: network or GitHub API failure
- **WHEN** manifest 或 artifact 下载失败
- **THEN** CodePulse Center 显示可理解的失败提示
- **AND** 保留任何已验证的既有 companion 安装

### Requirement: Floating companion 会话卡片展示
系统 SHALL 以只读卡片展示每个可见会话，并使用固定状态色表达运行中、已完成、错误和等待确认四种状态。

#### Scenario: 运行中卡片展示绿色呼吸状态圆点
- **WHEN** 会话状态为运行中
- **THEN** 会话卡片展示绿色状态圆点
- **AND** 状态圆点使用 pulse 动画

#### Scenario: 已完成卡片展示蓝色状态圆点
- **WHEN** 会话状态为已完成
- **THEN** 会话卡片展示蓝色状态圆点
- **AND** 卡片不使用 pulse 动画

#### Scenario: 错误卡片展示红色状态和摘要
- **WHEN** 会话状态为错误
- **THEN** 会话卡片展示红色状态圆点
- **AND** 卡片边框使用轻微红色警示样式
- **AND** 卡片上下文行展示单行截断的错误摘要

#### Scenario: 等待确认卡片展示黄色状态和原因
- **WHEN** 会话状态为等待确认
- **THEN** 会话卡片展示黄色状态圆点
- **AND** 卡片上下文行展示等待原因或默认等待用户确认文案

#### Scenario: 路径行中间截断并保留完整路径
- **WHEN** 会话路径长于卡片可用宽度
- **THEN** 会话卡片路径行展示中间截断后的路径
- **AND** 路径元素通过 `title` 属性提供完整路径
- **AND** 唯一复制路径动作位于同一行最右侧

#### Scenario: 卡片展示进程存活时长
- **WHEN** 会话存在可用于计算时长的时间字段
- **THEN** 会话卡片第一行右侧展示短时长文本
- **AND** 时长区域保持稳定尺寸，不挤压路径和上下文摘要

#### Scenario: 卡片使用紧凑两行自然高度布局
- **WHEN** 会话卡片没有错误摘要或等待原因以外的额外日志信息
- **THEN** 卡片第一行左侧展示状态圆点和主标题
- **AND** 卡片第一行右侧展示引擎名称和运行时长
- **AND** 卡片第二行左侧展示暗色小字号路径
- **AND** 卡片第二行右侧展示复制路径图标按钮
- **AND** 卡片高度由内容自然撑开，不使用固定高度、最小高度、`flex-grow` 或两端垂直分布造成额外底部留白

