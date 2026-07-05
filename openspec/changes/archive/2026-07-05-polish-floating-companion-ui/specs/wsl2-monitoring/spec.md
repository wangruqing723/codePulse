## ADDED Requirements

### Requirement: Floating companion 图标按钮交互
系统 SHALL 在窗口操作按钮使用图标化内容时，仍正确处理用户对按钮内部图标元素的点击。

#### Scenario: 点击隐藏图标内部元素
- **WHEN** 用户点击隐藏按钮内部的图标元素
- **THEN** companion 触发 `hide` 窗口动作

#### Scenario: 点击最小化图标内部元素
- **WHEN** 用户点击最小化按钮内部的图标元素
- **THEN** companion 触发 `minimize` 窗口动作

#### Scenario: 点击强制退出图标内部元素
- **WHEN** 用户点击强制退出按钮内部的图标元素
- **THEN** companion 触发 `force-exit` 窗口动作

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
