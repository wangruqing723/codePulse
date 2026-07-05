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

- `wsl2-monitoring`: 增加 Raycast 管理的 Floating Companion bootstrap 行为，覆盖 public GitHub Release manifest/zip 下载、hash 校验、本地安装和启动。

## Impact

- Raycast command: `src/setup-hooks.tsx`
- Companion bootstrap/download/install helper modules under `src/companion`
- Raycast preferences: optional companion release tag or manifest URL override
- Test stubs: Raycast API mock and companion bootstrap unit tests
- Packaging/release scripts or GitHub Actions for companion zip artifacts and SHA-256 manifest
- Documentation: README / companion docs for public GitHub Release artifact setup and installation flow
