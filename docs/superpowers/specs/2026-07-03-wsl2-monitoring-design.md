---
comet_change: wsl2-monitoring
role: technical-design
canonical_spec: openspec
---

# CodePulse 跨平台悬浮窗 + WSL2 监控设计

日期: 2026-07-03
状态: 用户已确认范围变更

## 背景

CodePulse 当前是 macOS Raycast 扩展，主要入口是 `menu-bar` command。状态核心已经集中在 `src/lib`：扫描 Claude/Codex transcript、合并 hook 事件、生成 `StateSnapshot`，再由 Raycast 菜单栏渲染。

Windows 目标场景不同：Claude Code 和 Codex CLI 都运行在同一个默认 WSL2 发行版内，Windows 侧需要显眼、实时、低操作成本的状态入口。Raycast for Windows 可以作为后续配置或健康检查入口，但 Windows 平台不支持 `menu-bar` command，不能承载核心体验。

最初设计采用 Windows 状态区 companion。用户进一步确认该入口不够显眼，因为任务栏程序图标只能说明应用正在运行，不能直接展示“轮到你了 / 运行中 / WSL 不可用”等状态。因此本阶段主入口改为 Electron 悬浮窗 companion，并纳入 Windows 与 macOS 两个平台。macOS 现有 Raycast menu-bar、Setup Hooks、supportPath events 和本机文件扫描必须保持不变。

## 目标与非目标

目标：

- Windows 和 macOS 上提供 Electron 悬浮窗 companion，展示最紧急的会话状态和会话数量。
- 悬浮窗默认置顶。
- 悬浮窗显示明确文字状态，例如 `轮到你了 2 个`、`运行中 1 个`、`WSL 不可用`。
- 悬浮窗提供隐藏/最小化按钮，隐藏或最小化后后台刷新继续。
- 悬浮窗支持贴边隐藏大半部分，鼠标移入展开，鼠标移开再次隐藏。
- 复用现有 TypeScript 状态判定逻辑，避免 macOS、Windows、Raycast 和 companion 分叉出多套规则。
- Windows 从默认 WSL2 发行版读取 `~/.claude/projects`、`~/.codex/sessions` 和 WSL-local `~/.codepulse/events`。
- Windows 会话支持复制 WSL 路径和 Windows UNC 路径；macOS 会话支持复制本机路径。
- 核心功能可运行后补充基础 Electron 打包命令和文档。
- 保持 macOS Raycast menu-bar、Setup Hooks、supportPath events、本机 transcript 文件扫描和 iTerm2 动作不回退。

非目标：

- 不实现 Windows Terminal 打开或聚焦。
- 不支持多个 WSL2 发行版选择。
- 不做自动更新、代码签名、复杂安装器定制或开机自启。
- Raycast 扩展不负责启动、停止或管理 Electron companion 进程。
- 不移除或替换 macOS Raycast menu-bar。

## 总体方案

采用“共享状态核心 + Electron 悬浮窗入口 + Raycast 现有入口并行”的结构。

```text
macOS Raycast menu-bar ─────────┐
                                ▼
                         shared state core
                                ▲
                                │
macOS Electron Floating ────────┤── local macOS home
                                │
Windows Electron Floating ──────┘── WSL2 UNC roots
```

共享核心负责：

- 根据配置扫描 Claude/Codex transcript root。
- 读取指定 event root 下的 hook/notify 事件。
- 合并被动扫描和主动事件。
- 应用状态优先级、排序、去抖和计数。
- 输出平台无关的 `StateSnapshot`。

平台入口负责：

- macOS Raycast：继续使用 `environment.supportPath`、Raycast preferences、MenuBarExtra、Setup Hooks 和 iTerm2 动作。
- macOS companion：独立 Electron 悬浮窗，读取本机 transcript，不改写 Raycast hook 或 supportPath 配置。
- Windows companion：负责默认 WSL2 distro 探测、UNC root 构造、悬浮窗 UI、贴边隐藏、剪贴板复制、错误/空态展示和打包。

## 关键模块设计

### 1. 扫描 root 配置化

当前 `src/lib/scanners.ts` 内部直接使用 `expandHome("~/.claude/projects")` 和 `path.join(os.homedir(), ".codex", "sessions")`。需要把扫描路径改为配置输入，同时保留 macOS 默认值。

建议新增类型：

```ts
interface ScanRoots {
  claudeProjectsRoot: string;
  codexSessionsRoot: string;
}

interface ScanOptions {
  activeWindowMs: number;
  monitorPrefixes: string[];
  now?: number;
  roots?: Partial<ScanRoots>;
}
```

默认行为不传 `roots`，继续读取当前 macOS home。Windows companion 传入 UNC roots：

- `\\wsl$\<distro>\home\<user>\.claude\projects`
- `\\wsl$\<distro>\home\<user>\.codex\sessions`

`scanClaudeFile`、`scanCodexFile`、状态推断函数保持平台无关，只处理文件内容和路径字符串。

### 2. 状态构建配置化

当前 `buildState(supportPath, preferences)` 同时承担 snapshot 存储路径、hook events 路径、扫描 root 和偏好解析。新增 `buildStateFromConfig` 把这些输入拆开。

```ts
interface StateBuildConfig {
  stateRoot: string;
  eventRoot?: string;
  scanRoots?: Partial<ScanRoots>;
  preferences: Preferences;
  now?: number;
}
```

保留现有 `buildState(supportPath, preferences)` 作为 macOS Raycast 兼容包装：

- `stateRoot = supportPath`
- `eventRoot = path.join(supportPath, "events")`
- `scanRoots` 使用默认 home

Windows companion 使用：

- `stateRoot` 为 companion 自己的 Windows app data 目录。
- `eventRoot` 为 WSL UNC events 目录，例如 `\\wsl$\<distro>\home\<user>\.codepulse\events`。
- `scanRoots` 为 WSL UNC transcript roots。

macOS companion 使用：

- `stateRoot` 为 companion 自己的 macOS app data 目录。
- `scanRoots` 使用默认 home。
- 默认不改写 Raycast supportPath events；如后续需要共享 Raycast hook events，应通过显式配置接入。

补充约束：

- Codex CLI 在存在 subagent 时，父会话与子会话的 transcript / event 归因必须保持隔离。
- 菜单栏与 companion 的状态合并逻辑不得让 subagent 活动把父会话从 `running` 错误重置为其他状态。
- 后续修复时应优先检查 session identity、最新事件归因和父子会话状态优先级，而不是只按项目路径或最近文件写入时间覆盖。

### 3. WSL2 adapter

新增 `src/lib/wsl.ts`，职责保持窄边界：

- 调用 `wsl.exe -l -v` 或等价命令探测默认 distro。
- 在默认 distro 内解析 WSL home，例如通过 `wsl.exe sh -lc 'printf %s "$HOME"'` 获取 `/home/<user>`。
- 把 WSL path 转换为 Windows UNC path。
- 构造 Claude/Codex/events root。

路径转换规则：

- `/home/user/project` + `Ubuntu` -> `\\wsl$\Ubuntu\home\user\project`
- 只支持绝对 WSL path；相对路径返回不可转换错误或 `undefined`。

默认 distro 探测失败、WSL 未启动、UNC root 不可读时，adapter 返回结构化错误，悬浮窗展示“WSL 不可用”，刷新循环继续运行。

### 4. Floating companion UI

Electron companion 使用 `BrowserWindow` 承载 renderer，而不是把状态藏在系统状态区菜单里。推荐结构：

- `src/companion/main.ts`：创建窗口、控制 always-on-top、读取屏幕信息、持久化窗口位置、调度状态刷新。
- `src/companion/geometry.ts`：纯函数处理吸附边缘、隐藏位置、展开位置和多屏边界。
- `src/companion/state-source.ts`：根据平台选择 macOS local roots 或 Windows WSL roots。
- `src/companion/view-model.ts`：把 `StateSnapshot` 转成 UI 文案、会话分组和路径动作。
- `src/companion/renderer.tsx`：渲染悬浮窗内容和按钮。

窗口行为：

- 默认 `alwaysOnTop: true`。
- 初始尺寸保持小而可读，例如宽 300-360px，高度按状态和会话数约束。
- 顶部显示聚合状态文字，等待优先于错误，错误优先于运行，运行优先于完成/空闲。
- 隐藏按钮将窗口隐藏或最小化，但不停止主进程刷新。
- 拖到屏幕边缘后进入 docked 状态。
- docked 状态下鼠标离开窗口后只露出一条可见边栏。
- 鼠标移入可见边栏后展开完整窗口。
- 鼠标移开后再次缩回隐藏位置。

### 5. WSL-local hook events

hook 脚本在 WSL 内执行，所以 Windows/WSL 事件写入 WSL 文件系统：

```text
~/.codepulse/events
```

现有 macOS `src/lib/hooks.ts` 生成的脚本把事件写入 Raycast `supportPath/events`。本阶段需要参数化 hook 脚本的事件输出目录，但默认调用保持 macOS 行为不变：

```ts
interface HookInstallOptions {
  supportPath: string;
  eventRoot?: string;
  claudeSettingsPath?: string;
  codexConfigPath?: string;
}
```

macOS Raycast 默认继续写 Raycast `supportPath/events`。Windows/WSL setup 使用 WSL 内路径写入 `~/.codepulse/events`，并写入 WSL 内的 `~/.claude/settings.json` 和 `~/.codex/config.toml`。

### 6. 路径动作模型

`SessionRecord.cwd` 继续保留 agent 原始工作目录。

Windows companion 在渲染动作时根据当前 distro 做派生：

```ts
const wslPath = session.cwd;
const windowsPath = toWslUncPath(distro, session.cwd);
```

macOS companion 只提供本机路径复制：

```ts
const localPath = session.cwd;
```

不建议把 Windows UNC path 持久写入通用 `SessionRecord`，避免污染 macOS 数据模型。若实现时为了 UI 便利需要携带派生字段，应使用 companion 层 view model。

## 数据流

Windows companion 刷新流程：

1. 读取或缓存默认 WSL2 distro 信息。
2. 构造 UNC roots：transcript roots 和 WSL-local events root。
3. 调用共享状态构建函数。
4. 合并 hook events 和 transcript scan 结果。
5. 写入 companion 自己的 `state.json`。
6. 更新 floating window renderer state。
7. 用户选择复制路径时，把 WSL path 或 UNC path 写入剪贴板。

macOS companion 刷新流程：

1. 使用本机默认 scan roots。
2. 调用共享状态构建函数。
3. 写入 companion 自己的 `state.json`。
4. 更新 floating window renderer state。
5. 用户选择复制路径时，把本机 cwd 写入剪贴板。

macOS Raycast 刷新流程保持原样，只通过兼容 wrapper 进入新配置化核心。

## 错误处理

- WSL 默认 distro 无法解析：悬浮窗展示 `WSL 不可用`，并在详情中显示错误摘要。
- UNC root 不存在或无法读取：对应扫描返回空列表或错误态；刷新循环继续。
- 单个 JSONL 文件解析失败：沿用当前策略，跳过坏行或坏文件，不影响其他会话。
- WSL-local events 中有坏 JSON：跳过该事件。
- hook 脚本异常：继续静默退出，不能阻塞 Claude/Codex。
- clipboard 写入失败：仅提示当前动作失败，不影响刷新。
- 贴边隐藏计算异常：回退到屏幕右侧默认位置，不移动到屏幕外不可达区域。

## 打包策略

打包纳入本阶段，但排在核心功能之后。

建议提供 3 个脚本名：`companion:dev` 启动开发模式悬浮窗，`companion:build` 编译 companion 主进程和 renderer，`companion:package` 生成本地 Windows/macOS companion artifact。具体命令由最终采用的 Electron 打包工具决定，并在实现时写入 `package.json`。

不在本阶段解决代码签名、自动更新、开机自启和 Raycast 代管 companion。

## 测试策略

单元测试：

- WSL path 到 UNC path 转换。
- 默认 distro 解析输出的解析函数。
- Claude/Codex scan root 配置化，确保不传 roots 时 macOS 默认路径不变。
- WSL-local eventRoot 读取和 `mergeHookEvents` 合并。
- monitor prefix 对 WSL path 的匹配。
- floating companion view model：dominant status、聚合文案、会话分组、路径动作。
- floating geometry：贴边检测、隐藏位置、展开位置、多屏边界和最小可见边栏。

集成/构建验证：

- `npm test`
- `npm run lint`
- `npm run build`
- `npm run companion:build`
- 当前平台可运行 `npm run companion:dev` 时，手动验证窗口非空、置顶、可隐藏、可贴边展开。

手动验证：

- macOS Raycast menu-bar 仍能刷新、展示会话、安装/卸载 hooks。
- macOS floating companion 能启动、刷新本机会话、贴边隐藏并复制本机路径。
- Windows + 默认 WSL2 环境中，floating companion 能读取 Claude/Codex transcript。
- WSL-local events 写入后，waiting/done 状态能合并到会话。
- Windows floating companion 能复制 `/home/user/project` 和 `\\wsl$\<distro>\home\user\project`。
- Raycast 关闭后 Windows companion 继续刷新。

## 实施顺序

1. 抽象扫描 roots 和 state build config，保留 macOS Raycast wrapper。
2. 新增 WSL2 adapter 与路径转换测试。
3. 支持 WSL UNC transcript root 和 WSL-local events root。
4. 新增 Electron floating companion 主进程、renderer 和状态 view model。
5. 实现 always-on-top、隐藏/最小化、贴边隐藏、hover 展开和窗口位置持久化。
6. 实现 Windows 双路径复制和 macOS 本机路径复制。
7. 参数化 hook install/event root，补 Setup/健康检查分工，同时保护 macOS 默认行为。
8. 补基础打包配置和文档。
9. 跑自动化验证，并分别在 macOS 与 Windows + WSL2 做手动验证。

## 风险与缓解

- 贴边隐藏跨平台细节复杂：窗口几何抽成纯函数测试，真实窗口只负责应用坐标。
- always-on-top 可能打扰工作流：提供隐藏/最小化按钮，并保留后续偏好项空间。
- `\\wsl$` 慢或不可用：所有读取都要被捕获，悬浮窗进入不可用状态，不让进程崩溃。
- 默认 distro 不正确：本阶段明确只支持默认 distro，并在错误态中展示探测结果。
- Electron 增加依赖和体积：限制在新增 companion；Raycast extension 仍独立构建。
- 状态逻辑回归：共享核心改造必须配套 macOS 默认路径和现有状态测试。
- hook 事件与 transcript 冲突：继续沿用 freshness、debounce 和事件优先级规则，并补 WSL eventRoot 测试。

## Spec Patch

已回写 OpenSpec delta spec：将旧 Windows 状态区 companion 改为跨平台 Electron 悬浮窗 companion；新增 always-on-top、隐藏/最小化、贴边隐藏、hover 展开、macOS 现有行为保持不变和 macOS 本机路径复制场景。
