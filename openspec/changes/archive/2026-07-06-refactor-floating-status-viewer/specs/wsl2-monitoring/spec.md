## MODIFIED Requirements

### Requirement: 跨平台悬浮窗状态 companion
系统 SHALL 提供一个 Electron floating companion，在 Windows 和 macOS 上以深色模式悬浮窗形式运行，并在用户不打开 Raycast command 的情况下展示 CodePulse 会话状态。该悬浮窗 SHALL 作为纯状态查看器，不在悬浮窗内提供终止进程、打开终端或启动/停止会话等控制操作。

#### Scenario: 悬浮窗展示聚合状态摘要
- **WHEN** 至少一个受监控的 Claude Code 或 Codex CLI 会话处于运行中、已完成、错误或等待确认状态
- **THEN** 悬浮窗头部展示这些状态的数字汇总
- **AND** 汇总仅使用运行中、已完成、错误和等待确认这四种状态

#### Scenario: 错误状态优先突出
- **WHEN** 至少一个受监控会话处于错误状态，且其他会话处于运行中、已完成或等待确认状态
- **THEN** 悬浮窗将错误作为最高优先级状态突出展示
- **AND** 仍可展示其他非零状态的数字汇总

#### Scenario: 悬浮窗默认置顶
- **WHEN** floating companion 启动
- **THEN** 悬浮窗默认以 always-on-top 方式显示在其他普通窗口之上

#### Scenario: 用户切换置顶
- **WHEN** 用户点击悬浮窗头部的置顶控件
- **THEN** companion 切换窗口 always-on-top 状态
- **AND** 不停止后台状态刷新

#### Scenario: 用户最小化悬浮窗
- **WHEN** 用户点击悬浮窗头部的最小化控件
- **THEN** companion 最小化悬浮窗
- **AND** 不停止后台状态刷新

#### Scenario: 用户关闭悬浮窗
- **WHEN** 用户点击悬浮窗头部的关闭控件
- **THEN** companion 关闭悬浮窗进程
- **AND** 不对任何受监控 Claude Code 或 Codex CLI 进程执行终止操作

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

### Requirement: Floating companion 图标按钮交互
系统 SHALL 在窗口操作按钮使用图标化内容时，仍正确处理用户对按钮内部图标元素的点击。窗口操作按钮 SHALL 仅包含置顶、最小化和关闭。

#### Scenario: 点击置顶图标内部元素
- **WHEN** 用户点击置顶按钮内部的图标元素
- **THEN** companion 触发 `pin` 窗口动作

#### Scenario: 点击最小化图标内部元素
- **WHEN** 用户点击最小化按钮内部的图标元素
- **THEN** companion 触发 `minimize` 窗口动作

#### Scenario: 点击关闭图标内部元素
- **WHEN** 用户点击关闭按钮内部的图标元素
- **THEN** companion 触发 `close` 窗口动作

## ADDED Requirements

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
- **THEN** 会话卡片右下角展示短时长文本
- **AND** 时长区域保持稳定尺寸，不挤压路径和上下文摘要
