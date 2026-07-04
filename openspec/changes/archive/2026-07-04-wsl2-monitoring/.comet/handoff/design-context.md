# Comet Design Handoff

- Change: wsl2-monitoring
- Phase: design
- Mode: compact
- Context hash: b1b65a3c6127eb2cb1e967493dc2772254494b52246d7061ebbc2c1e1ac21c67

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/wsl2-monitoring/proposal.md

- Source: openspec/changes/wsl2-monitoring/proposal.md
- Lines: 1-29
- SHA256: b5e66abdfe6c54e02c60997de74133b2cb1c9f63dc9bff2eaac96461c365d424

```md
## Why

CodePulse 当前默认 Claude Code 和 Codex CLI 会话与 Raycast menu-bar 扩展运行在同一个 macOS 文件系统中。Windows 用户把两个 CLI 安装在 WSL2 内后，仍需要一个显眼、实时、低操作成本的会话状态入口，但 Raycast for Windows 目前不支持 `menu-bar` command。

## What Changes

- 新增 Windows + WSL2 监控能力，核心入口是 Windows Electron 系统托盘 companion。
- 保留现有 macOS Raycast menu-bar command，不改变 macOS 体验。
- 通过 `\\wsl$` 从默认 WSL2 发行版读取 Claude Code 和 Codex CLI transcript。
- 在 WSL 内安装 hook/notify 脚本，把 CodePulse 事件写入 WSL 文件系统。
- 在 Windows 托盘展示聚合会话状态，并从托盘入口打开会话列表。
- 每个会话支持复制 WSL 路径和 Windows UNC 路径。
- 核心托盘流程可用后，再补充基础 Electron 打包。
- 本次不实现 Windows Terminal 聚焦/打开，也不实现可选悬浮窗。

## Capabilities

### New Capabilities
- `wsl2-monitoring`: 监控默认 WSL2 发行版内运行的 Claude Code 和 Codex CLI 会话，并通过 Windows 托盘 companion 展示状态。

### Modified Capabilities

## Impact

- 新增 Electron Windows companion 应用和相关 package/build 配置。
- 扩展共享会话扫描与状态逻辑，支持 WSL2 root 和 Windows UNC 路径转换。
- 更新 hook 安装逻辑，支持 WSL-local 事件输出。
- 新增 WSL2 路径转换、WSL 事件发现和共享状态行为测试。
- 完整手动验证需要 Windows + WSL2 环境；macOS 行为必须保持不变。
```

## openspec/changes/wsl2-monitoring/design.md

- Source: openspec/changes/wsl2-monitoring/design.md
- Lines: 1-69
- SHA256: 4e4a06939f6d8f31c1b9498aafbe9af77077cb9c5123e8e241857ae94f13602e

```md
## Context

CodePulse 当前是 Raycast 扩展，主入口是 macOS `menu-bar` command。核心逻辑已经拆在 `src/lib` 中，包括 Claude/Codex JSONL 扫描、状态推断、hook 事件合并、通知和 iTerm2 聚焦。Windows 目标场景不同：Claude Code 和 Codex CLI 都运行在同一个默认 WSL2 发行版内，而 Raycast for Windows 虽然支持扩展，但官方文档明确 `menu-bar` command 不支持 Windows。

因此 Windows 版需要一个独立的常驻可见入口。Raycast Windows 扩展可以继续作为配置和健康检查入口，但不能承担“显眼实时状态”的主体验。

## Goals / Non-Goals

**Goals:**

- 在 Windows 提供系统托盘 companion，实时展示最紧急的 Claude/Codex 会话状态。
- 从默认 WSL2 发行版读取 `~/.claude/projects`、`~/.codex/sessions` 和 WSL-local CodePulse events。
- 复用现有 TypeScript 状态推断逻辑，避免 macOS 与 Windows 维护两套判定规则。
- 会话列表支持复制 WSL 路径和 Windows UNC 路径。
- 核心功能完成后，提供基础 Electron 打包路径。
- 保持现有 macOS Raycast menu-bar 行为不回退。

**Non-Goals:**

- 本阶段不实现 Windows Terminal 打开或聚焦。
- 本阶段不实现悬浮窗；悬浮窗作为后续可选能力。
- 本阶段不支持多个 WSL2 发行版。
- 本阶段不做自动更新、代码签名或复杂安装器定制。
- Raycast Windows 扩展不负责启动或管理 companion 进程。

## Decisions

1. Windows 常驻入口使用 Electron `Tray`

Electron 对 Windows 系统托盘支持成熟，并且项目现有逻辑是 TypeScript。使用 Electron 可以直接复用状态扫描和路径处理代码。备选方案是 .NET/WinUI companion，但会迫使状态逻辑迁移或重复实现；PowerShell 托盘脚本打包和后续悬浮窗扩展性较弱。

2. Raycast 扩展和 companion 各自管理生命周期

Raycast 负责配置、Setup、健康检查和 macOS 现有入口；Windows companion 负责托盘、轮询、状态展示和复制动作。这样 companion 不依赖 Raycast 常开，也避免 Raycast 扩展变成外部进程管理器。

3. WSL 事件先写入 WSL 内部

Claude/Codex hook 在 WSL 内执行，所以脚本应写入 WSL-local 目录，例如 `~/.codepulse/events`。Windows companion 再通过 `\\wsl$\<distro>\...` 读取。备选方案是 hook 直接写 Windows supportPath，但这会让 WSL 脚本依赖 Windows 用户路径和 companion 安装路径，配置更脆弱。

4. 第一阶段只支持默认 WSL2 发行版

用户已确认 Claude Code 和 Codex CLI 在同一个默认 WSL2 发行版内。实现上通过 `wsl.exe` 或等价探测拿到默认发行版名，并把 WSL path 转换为 `\\wsl$\<distro>\...`。多发行版选择留到后续。

5. 打包纳入本阶段但排在最后

先完成开发模式下可运行的托盘 companion，再补基础打包命令。打包不应阻塞扫描、状态展示、路径复制和 hook 事件读取这些核心功能。

## Risks / Trade-offs

- [Risk] `\\wsl$` 访问慢或 WSL 未启动时读取失败 -> companion 要显示不可用状态，并避免刷新循环抛错退出。
- [Risk] Electron 增加依赖和包体积 -> 仅用于 Windows companion，macOS Raycast 扩展保持现状。
- [Risk] 默认 WSL distro 与实际 CLI 所在 distro 不一致 -> MVP 明确只支持默认 distro，并在健康检查中暴露检测结果。
- [Risk] hook 事件和 passive transcript 状态冲突 -> 继续沿用现有事件 freshness 和 debounce 规则，并为 WSL event path 增加测试。
- [Risk] Windows 托盘图标可能被系统收进隐藏区 -> 状态变化通知作为后续可补强项，本阶段优先保证托盘菜单和 tooltip 正确。

## Migration Plan

1. 抽象共享扫描入口，使 macOS home 扫描和 Windows WSL UNC 扫描都调用同一套状态推断函数。
2. 新增 WSL2 路径解析与默认 distro 探测模块。
3. 新增 Electron companion 入口，以开发模式运行托盘状态展示。
4. 调整 hook 安装逻辑，使 Windows/WSL 路径下的事件写入 WSL-local events。
5. 补充基础打包脚本和文档。

Rollback 策略：如果 Windows companion 功能不完整，macOS Raycast extension 仍保持现有行为；Windows 新入口可以不发布或不打包。

## Open Questions

- Windows 状态变化通知是否放入本 change，还是作为托盘 MVP 后的独立增强。
- companion 是否需要开机自启，若需要应随基础打包一起做还是后续单独做。
```

## openspec/changes/wsl2-monitoring/tasks.md

- Source: openspec/changes/wsl2-monitoring/tasks.md
- Lines: 1-33
- SHA256: 93371c6414d2e494753a7be5aa4d1ba2d1b2f64244b83ece1dd3fcfd9f0dce03

```md
## 1. 共享状态与 WSL2 路径基础

- [ ] 1.1 抽象扫描 root 配置，使 Claude/Codex 扫描可接收 macOS home 或 Windows WSL UNC root
- [ ] 1.2 新增默认 WSL2 distro 探测与 WSL path 到 Windows UNC path 的转换工具
- [ ] 1.3 为 WSL path、UNC path、monitor prefix 匹配补充单元测试

## 2. WSL2 transcript 与事件读取

- [ ] 2.1 支持从默认 WSL2 发行版读取 Claude Code transcript
- [ ] 2.2 支持从默认 WSL2 发行版读取 Codex CLI transcript
- [ ] 2.3 支持从 WSL-local CodePulse events 目录读取 hook/notify 事件
- [ ] 2.4 为 WSL transcript 扫描和 WSL event 合并补充测试

## 3. Windows Electron 托盘 companion

- [ ] 3.1 添加 Electron companion 入口和开发运行脚本
- [ ] 3.2 实现托盘图标、tooltip 和聚合状态刷新
- [ ] 3.3 实现托盘会话列表，展示 agent、项目名、状态和更新时间
- [ ] 3.4 实现复制 WSL 路径和 Windows UNC 路径动作
- [ ] 3.5 处理 WSL 不可用、无会话、扫描失败等空态和错误态

## 4. Hook 安装与 Setup 分工

- [ ] 4.1 让 Windows/WSL hook 脚本写入 WSL-local CodePulse events 目录
- [ ] 4.2 更新 Raycast Setup/健康检查，使其展示 companion 与 WSL hook 的状态但不管理 companion 进程
- [ ] 4.3 保持 macOS hook 安装和 menu-bar 行为不变

## 5. 打包与验证

- [ ] 5.1 添加基础 Windows companion 打包配置和命令
- [ ] 5.2 记录 Windows companion 开发运行、打包运行和 WSL2 前置条件
- [ ] 5.3 运行 lint、build、test，并手动验证 macOS 现有入口不回退
- [ ] 5.4 在 Windows + 默认 WSL2 环境中验证托盘状态、会话列表和双路径复制
```

## openspec/changes/wsl2-monitoring/specs/wsl2-monitoring/spec.md

- Source: openspec/changes/wsl2-monitoring/specs/wsl2-monitoring/spec.md
- Lines: 1-68
- SHA256: f779d28fa703acd76cc5c5b428dd10a6f7f2ada60f16c00496b72b10ec9ebda2

```md
## ADDED Requirements

### Requirement: Windows 托盘状态 companion
系统 SHALL 提供一个 Windows Electron companion，以系统托盘应用形式运行，并在用户不打开 Raycast command 的情况下展示最紧急的 CodePulse 会话状态。

#### Scenario: 托盘展示聚合等待状态
- **WHEN** 至少一个受监控的 WSL2 Claude Code 或 Codex CLI 会话正在等待用户输入或授权
- **THEN** 托盘 companion 在托盘 tooltip 或托盘菜单中展示等待聚合状态和等待会话数量

#### Scenario: 托盘展示聚合运行状态
- **WHEN** 没有会话等待用户，并且至少一个受监控的 WSL2 会话正在运行
- **THEN** 托盘 companion 在托盘 tooltip 或托盘菜单中展示运行聚合状态和运行会话数量

#### Scenario: Raycast 关闭后托盘仍可用
- **WHEN** Windows companion 启动后 Raycast 被关闭
- **THEN** 托盘 companion 继续独立刷新并展示会话状态

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
- **THEN** Windows companion 报告监控不可用状态且不崩溃

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

### Requirement: 双路径复制动作
系统 SHALL 允许用户从 Windows 托盘会话列表复制受监控会话的 WSL 路径和 Windows UNC 路径。

#### Scenario: 复制 WSL 路径
- **WHEN** 用户对 cwd 为 `/home/user/project` 的会话选择复制 WSL 路径动作
- **THEN** 剪贴板收到 `/home/user/project`

#### Scenario: 复制 Windows 路径
- **WHEN** 用户对默认发行版名为 `Ubuntu` 且 cwd 为 `/home/user/project` 的会话选择复制 Windows 路径动作
- **THEN** 剪贴板收到 `\\wsl$\Ubuntu\home\user\project`

### Requirement: 基础 Windows companion 打包
系统 SHALL 在核心托盘监控流程可用后，提供 Windows Electron companion 的基础打包路径。

#### Scenario: 打包命令构建 companion
- **WHEN** 维护者运行文档化的 Windows companion package 命令
- **THEN** 项目产出本地可安装或可运行的 Windows companion artifact

#### Scenario: 打包不阻塞核心开发
- **WHEN** 托盘监控流程在打包完成前进行开发或测试
- **THEN** companion 仍可通过开发模式运行以完成核心功能验证
```

