# Brainstorm Summary

- Change: bootstrap-floating-companion
- Date: 2026-07-05

## 确认的技术方案

已确认。将现有 `launch-control` 草稿改写为 `companion-bootstrap`：CodePulse Center 提供 `Install / Start Floating Companion`，优先启动 `environment.supportPath` 中已安装的 companion；若不存在，则在当前仓库转为 public 后，通过公共 GitHub Release 裸 URL 下载 manifest 和平台 zip，校验 SHA-256 后解压到版本化目录，再通过 Raycast `open(target)` 启动。首版不实现 private GitHub token 下载流程。

## 关键取舍与风险

- 采用 public GitHub Release 裸 URL，前提是用户后续将当前仓库转为 public。
- 不在首版实现 private token 下载，降低用户配置和 token 权限风险。
- 采用 SHA-256 校验和版本化 supportPath 安装，降低运行时下载 executable 的供应链风险。
- macOS arm64 做首个完整闭环；Windows x64 预留 manifest 和安装路径，artifact 生成优先通过 Windows runner 或后续 CI。
- 未签名 macOS companion 可能被 Gatekeeper 拦截，签名/notarization 不在本轮完成。

## 测试策略

- bootstrap helper 单元测试：已安装直接启动、release unavailable、unsupported platform、hash mismatch、download failure。
- CodePulse Center 单元测试：成功、release unavailable、平台不支持、校验失败、网络失败 toast。
- 发行产物脚本测试：macOS arm64 zip 和 sha256 manifest 生成路径。
- 最终验证：focused tests、`npm test`、`npm run lint`、`npm run build`、`npm run companion:build`。

## Spec Patch

已回写 OpenSpec delta spec：private release/token 场景改为 public GitHub Release 裸 URL，新增 release unavailable 场景。
