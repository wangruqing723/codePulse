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
