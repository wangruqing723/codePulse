# Comet Design Handoff

- Change: bootstrap-floating-companion
- Phase: design
- Mode: compact
- Context hash: c5daa94181f58ca7e717d6e762df12a283a4c97d4343ca1d97a00459a07a38c4

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/bootstrap-floating-companion/proposal.md

- Source: openspec/changes/bootstrap-floating-companion/proposal.md
- Lines: 1-30
- SHA256: a0c260446448e6c0e95977e6e2961c305302591f0fa7dad720c4c38aea036c93

```md
## Why

CodePulse 已有 Electron Floating Companion，但 Raycast 组织 Store 只安装 extension，不会自动安装 `.app` 或 `.exe`。用户想要组织 Store 安装后仍能一键获得真正的悬浮窗，因此需要让 Raycast 端负责 companion 的受控 bootstrap：下载、校验、解压并启动 companion。

## What Changes

- 在 CodePulse Center 中提供 `Install / Start Floating Companion` 入口。
- 从当前仓库的 GitHub Release 获取 companion manifest 与平台 zip artifact。
- 首版目标假设仓库会在发布 companion artifact 前转为 public，并使用公共 GitHub Release 裸 URL 下载 manifest 与平台 zip。
- 将 companion artifact 安装到 `environment.supportPath` 下的版本化目录，后续启动复用本地安装。
- 下载后必须做 SHA-256 校验；校验失败不得启动，并清理不可信下载文件。
- macOS arm64 作为首个可验证目标；Windows x64 设计预留并优先通过目标平台或 CI runner 产出 artifact。
- 保留 `npm run companion:dev` 作为开发入口，但不作为组织 Store 用户方案。

## Capabilities

### New Capabilities

### Modified Capabilities

- `wsl2-monitoring`: 增加 Raycast 管理的 Floating Companion bootstrap 行为，覆盖 private GitHub Release 下载、hash 校验、本地安装和启动。

## Impact

- Raycast command: `src/setup-hooks.tsx`
- Companion bootstrap/download/install helper modules under `src/companion`
- Raycast preferences: optional companion release tag or manifest URL override
- Test stubs: Raycast API mock and companion bootstrap unit tests
- Packaging/release scripts or GitHub Actions for companion zip artifacts and SHA-256 manifest
- Documentation: README / companion docs for public GitHub Release artifact setup and installation flow
```

## openspec/changes/bootstrap-floating-companion/design.md

- Source: openspec/changes/bootstrap-floating-companion/design.md
- Lines: 1-70
- SHA256: f49fab7d7328722cdb021599d435f3c4031d491da28e58cc3c40318e631cfaae

```md
## Context

Raycast 官方 extension command mode 不提供任意 always-on-top desktop window；真正的悬浮窗仍需要 Electron companion。Raycast 组织 Store 发布的是 private extension，用户安装 extension 后不会自动得到 companion `.app` / `.exe`。Raycast 官方 Store 准备文档建议对额外下载尽量自动化，并要求下载 executable binary 时使用可信来源和 hash 校验；即使组织 Store 不走公共 PR review，这仍是组织内分发 executable 的安全底线。

当前项目已有 Electron companion、基础打包配置和 CodePulse Center recovery 入口。上一轮未提交草稿实现了“启动已安装 companion app”，但该方案假设用户已手动安装 `.app` / `.exe`，不满足组织 Store 一键使用目标。本 change 将把该草稿改写为 bootstrap 架构。

## Goals / Non-Goals

**Goals:**

- CodePulse Center 提供 `Install / Start Floating Companion`。
- 优先使用 `environment.supportPath` 中已安装、已验证的 companion。
- 首次安装从当前仓库 public GitHub Release 获取 manifest 和平台 artifact。
- 首版目标假设仓库会在发布 companion artifact 前转为 public，并通过公共裸 URL 下载 release artifact。
- 对下载 zip 执行 SHA-256 校验，校验通过后才解压和启动。
- macOS arm64 作为首个完整验证目标；Windows x64 设计预留，打包优先由 Windows runner 或后续 CI 完成。

**Non-Goals:**

- 不把 `npm run companion:dev` 暴露为组织 Store 用户方案。
- 不在本轮完成 code signing、notarization、auto-update daemon、DMG/MSI installer。
- 不把未经校验的 opaque binary 放进 Raycast extension assets。
- 不在首版实现 private GitHub token 下载流程。
- 不承诺在 Mac 本机可靠产出所有 Windows artifact。

## Decisions

### Decision 1: 使用 GitHub Release manifest 而不是固定裸 URL

当前仓库 GitHub Release 是 companion artifact 的来源。Raycast 端读取一个版本化 manifest，manifest 声明 version、platform key、public zip URL、sha256 和启动路径。这样能把平台选择、安全校验和本地安装路径与 UI 解耦。

替代方案是每个平台硬编码 zip URL。它实现更快，但不利于后续版本和平台扩展；manifest 仍然可以用公共裸 URL，同时保留版本管理和 hash 校验。

### Decision 2: 首版不实现 private token 下载

用户已决定后续将当前仓库转为 public，再使用公共 GitHub Release 裸 URL。首版不需要 GitHub token preference，也不走 GitHub private asset API。若仓库仍为 private 或 artifact 不存在，CodePulse Center 应显示 release artifact 不可用提示。

替代方案是继续支持 private release/token。它能在仓库仍 private 时使用，但增加用户配置成本和 token 权限风险；当前明确选择 public release 路径。

### Decision 3: 安装到 `environment.supportPath`

companion 安装目录位于 `environment.supportPath/companion/<version>/<platform-arch>/`。下载 zip 暂存到 `environment.supportPath/companion/downloads/`，校验通过后解压到版本化目录。后续启动先检查该目录是否存在并包含平台入口。

替代方案是安装到 `/Applications` 或 `%LOCALAPPDATA%`。那更像系统安装器，但权限、卸载和跨平台差异更复杂，也不符合 Raycast extension 自管理数据的边界。

### Decision 4: Windows 打包通过 CI/目标平台优先，Mac 交叉打包只作为尝试项

electron-builder 文档说明 macOS/Linux 可构建 Windows 目标的一部分格式，但不应假设一个平台可以可靠产出所有平台，特别是 native dependency 或某些 Windows installer 格式。当前 companion 可先尝试 portable Windows artifact，但验收以 Windows runner 或目标平台产物为准。

## Risks / Trade-offs

- [Risk] Raycast 组织 Store 对运行时下载 executable 没有公共 review 那样的流程说明，但 executable 下载仍有供应链风险 → 使用当前仓库 public GitHub Release、SHA-256 校验和清晰文档。
- [Risk] 仓库未及时转为 public 导致裸 URL 不可用 → UI 显示 release artifact 不可用提示，并保留开发模式说明。
- [Risk] macOS Gatekeeper 阻止未签名 companion → 本轮记录限制并显示错误；签名/notarization 后续单独处理。
- [Risk] Windows artifact 无法在 Mac 可靠打出 → CI 使用 Windows runner，Mac 只做 best-effort 或跳过 Windows artifact 发布。
- [Risk] 下载或解压失败留下半安装目录 → 使用 downloads 暂存和版本化目录，只在校验解压成功后标记为可启动。

## Migration Plan

1. 保留现有 companion dev/build/package 命令。
2. 将未提交的 `launch-control` 草稿改写为 bootstrap helper。
3. 增加 public GitHub release manifest 类型、下载、校验、解压和本地启动流程。
4. 更新 CodePulse Center action 文案为 `Install / Start Floating Companion`。
5. 增加文档说明 public GitHub Release artifact、仓库公开前限制和当前平台限制。

## Open Questions

- GitHub Release tag 默认使用 extension `package.json` version，还是允许 preference 指定 tag。
- 第一版是否只发布 macOS arm64 artifact，Windows x64 作为 manifest 预留但不启用。
- 是否在本 change 中加入 GitHub Actions workflow，还是先实现 Raycast bootstrap，CI 发布另开 change。
```

## openspec/changes/bootstrap-floating-companion/tasks.md

- Source: openspec/changes/bootstrap-floating-companion/tasks.md
- Lines: 1-30
- SHA256: ad8ecf30c060544e56e471329aa11b9eb64d85ecb45fd597bdec88295cf91294

```md
## 1. Bootstrap Contract And Preferences

- [ ] 1.1 Add Raycast preferences for optional release tag or manifest URL override.
- [ ] 1.2 Define companion release manifest types, platform keys, install paths, and local installed artifact resolution.
- [ ] 1.3 Replace the current launch-only helper draft with bootstrap-oriented tests for local installed artifact, release unavailable, unsupported platform, and hash mismatch.

## 2. Download, Verify, Install, Launch

- [ ] 2.1 Implement public GitHub release manifest and asset download.
- [ ] 2.2 Implement SHA-256 verification and safe download cleanup on mismatch.
- [ ] 2.3 Implement zip extraction into `environment.supportPath/companion/<version>/<platform-arch>/`.
- [ ] 2.4 Launch the installed companion artifact through Raycast `open(target)`.

## 3. CodePulse Center UX

- [ ] 3.1 Rename the action to `Install / Start Floating Companion`.
- [ ] 3.2 Show success, release-unavailable, unsupported-platform, network-failure, and hash-mismatch toasts.
- [ ] 3.3 Preserve the existing force-exit Floating Companion action.

## 4. Release Artifact Path

- [ ] 4.1 Add or document a companion release manifest format for current-repository GitHub Releases.
- [ ] 4.2 Add a packaging script or GitHub Actions workflow path for macOS arm64 companion zip and SHA-256 output.
- [ ] 4.3 Record Windows x64 packaging constraints and, if feasible, add a Windows runner packaging path.

## 5. Documentation And Verification

- [ ] 5.1 Document that the current repository must be public before using public release URLs.
- [ ] 5.2 Document current security and platform limitations, including unsigned companion behavior.
- [ ] 5.3 Run focused bootstrap tests, full test suite, `npm run lint`, `npm run build`, and `npm run companion:build`.
```

## openspec/changes/bootstrap-floating-companion/specs/wsl2-monitoring/spec.md

- Source: openspec/changes/bootstrap-floating-companion/specs/wsl2-monitoring/spec.md
- Lines: 1-40
- SHA256: b984bdaa5f8e7ede5990245c24b8c07e1cb4c5866d95e091fa9eebebcbaea291

```md
## ADDED Requirements

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
```

