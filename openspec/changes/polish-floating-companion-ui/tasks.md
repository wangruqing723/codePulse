## 1. Floating companion 顶部 polish

- [x] 1.1 将窗口操作按钮改为紧凑图标按钮，并保留可访问标签
- [x] 1.2 调整 header / 按钮 / 状态文字 CSS，降低窄窗口拥挤感
- [x] 1.3 补充 renderer 测试并运行轻量验证

## 2. 交互回归与偏好同步

- [x] 2.1 修复点击图标内部元素时窗口操作不触发的问题，并补充失败优先测试
- [x] 2.2 让 companion 使用 Raycast 配置的监控窗口和项目过滤偏好，并补充失败优先测试
- [x] 2.3 运行完整验证并同步 Comet 状态

## Review Gate

- [x] standard review：发现 Raycast `supportPath` 与 Electron `userData/state` 不是同一共享路径的风险；已改为双方可独立计算的 `~/.codepulse/companion-preferences.json`。
