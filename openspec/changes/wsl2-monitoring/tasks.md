## 1. 共享状态与 WSL2 路径基础

- [x] 1.1 抽象扫描 root 配置，使 Claude/Codex 扫描可接收 macOS home 或 Windows WSL UNC root
- [x] 1.2 新增默认 WSL2 distro 探测与 WSL path 到 Windows UNC path 的转换工具
- [x] 1.3 为 WSL path、UNC path、monitor prefix 匹配补充单元测试

## 2. WSL2 transcript、事件读取与 macOS 兼容

- [ ] 2.1 支持从默认 WSL2 发行版读取 Claude Code transcript
- [ ] 2.2 支持从默认 WSL2 发行版读取 Codex CLI transcript
- [ ] 2.3 支持从 WSL-local CodePulse events 目录读取 hook/notify 事件
- [ ] 2.4 保持 macOS Raycast 默认扫描本机 home 与 supportPath events
- [ ] 2.5 为 WSL transcript 扫描、WSL event 合并和 macOS 默认路径兼容补充测试

## 3. 跨平台 Electron 悬浮窗 companion

- [ ] 3.1 添加 Electron floating companion 入口、renderer 和开发运行脚本
- [ ] 3.2 实现默认置顶悬浮窗和实时文字聚合状态
- [ ] 3.3 实现会话列表，展示 agent、项目名、状态和更新时间
- [ ] 3.4 实现隐藏/最小化控件，隐藏后保持后台刷新
- [ ] 3.5 实现贴边隐藏、鼠标移入展开、鼠标移开再次隐藏
- [ ] 3.6 实现 Windows 双路径复制和 macOS 本机路径复制
- [ ] 3.7 处理 WSL 不可用、无会话、扫描失败等空态和错误态

## 4. Hook 安装与入口分工

- [ ] 4.1 让 Windows/WSL hook 脚本写入 WSL-local CodePulse events 目录
- [ ] 4.2 更新 Raycast Setup/健康检查，使其展示 companion 与 WSL hook 的状态但不管理 companion 进程
- [ ] 4.3 保持 macOS hook 安装、supportPath events、menu-bar 和文件扫描行为不变

## 5. 打包与验证

- [ ] 5.1 添加基础 Electron companion 打包配置和命令
- [ ] 5.2 记录 companion 开发运行、打包运行、macOS 保持兼容和 Windows WSL2 前置条件
- [ ] 5.3 运行 lint、build、test，并手动验证 macOS 现有 Raycast 入口不回退
- [ ] 5.4 在 Windows + 默认 WSL2 环境中验证悬浮窗状态、贴边隐藏、会话列表和双路径复制
- [ ] 5.5 在 macOS 环境中验证悬浮窗状态、贴边隐藏和本机路径复制
