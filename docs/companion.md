# CodePulse Companion

## 概览

CodePulse Companion 是独立的 Electron 悬浮窗入口，用来在 Windows 和 macOS 上显示 Claude Code / Codex CLI 的近期状态。

- macOS 现有 Raycast 菜单栏、Setup Hooks、通知与本机扫描行为保持不变。
- macOS 悬浮窗 companion 是额外入口，不替代 Raycast。
- Windows companion 通过 `\\wsl$` 读取默认 WSL2 发行版中的 transcript 与事件。
- WSL hook / notify 脚本写入 `~/.codepulse/events`，供 Windows companion 读取。

## 开发

先构建 companion：

```bash
npm run companion:build
```

开发运行：

```bash
npm run companion:dev
```

该命令会先生成 `dist-companion/`，再以 Electron 启动悬浮窗。

## 打包

本地打包命令：

```bash
npm run companion:package
```

打包输出目录为 `release/`。当前配置包含：

- macOS `dir` target
- Windows `portable` target

如果当前平台无法覆盖另一个目标平台的实际产物验证，需要在对应目标平台上再次执行 `npm run companion:package`。

## Windows + WSL2 前置条件

1. Windows 已安装并启用 WSL2。
2. 默认 WSL2 发行版可正常访问。
3. Claude Code / Codex CLI 在该默认发行版内运行。
4. WSL 内已安装 CodePulse hook / notify 集成，并向 `~/.codepulse/events` 写入事件。
5. Windows 主机可访问 `\\wsl$\<default-distro>\home\<user>\...` 路径。

## 手动验证清单

### 通用

1. 启动后悬浮窗默认置顶。
2. 点击隐藏/最小化后，窗口消失但后台继续刷新。
3. 无近期会话时显示空态，不崩溃。
4. 扫描失败时显示错误态，不崩溃。

### 贴边隐藏与展开

1. 将窗口贴边后进入隐藏状态。
2. 鼠标移入边缘时窗口重新展开。
3. 鼠标移开后窗口再次收起。

### 会话与路径动作

1. 会话列表显示 agent、项目名、状态和更新时间。
2. macOS 上复制本机路径成功。
3. Windows + WSL2 上可复制 WSL 路径与 `\\wsl$` UNC 路径两种形式。

### Windows + WSL2 特定检查

1. 默认 WSL2 distro 可用时，Claude / Codex transcript 能被读取。
2. WSL 不可用时，悬浮窗显示不可用状态。

### macOS 兼容性检查

1. Raycast 现有 menu-bar 入口仍可正常使用。
2. Setup Hooks 仍展示 companion 为独立运行，不负责拉起或停止 companion。
