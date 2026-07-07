## MODIFIED Requirements

### Requirement: Raycast 管理 Floating Companion bootstrap
系统 SHALL 允许用户通过 CodePulse Center 安装、更新并启动当前版本的 Electron Floating Companion，而不要求用户手动下载、复制或安装 companion `.app` / `.exe`。

#### Scenario: 已安装当前版本 companion 时直接启动
- **WHEN** `environment.supportPath` 中存在当前扩展版本和平台匹配的 companion artifact
- **THEN** CodePulse Center 的安装/更新/启动动作直接打开该本地 artifact
- **AND** 不重新下载 artifact

#### Scenario: 当前版本 companion 未安装时自动下载安装
- **WHEN** 当前仓库已转为 public
- **AND** 当前平台存在匹配的 companion release artifact
- **AND** `environment.supportPath` 中不存在当前扩展版本和平台匹配的 companion artifact
- **THEN** CodePulse Center 通过公共 GitHub Release URL 下载 manifest 和对应平台 zip
- **AND** 使用 SHA-256 校验下载内容
- **AND** 校验通过后解压到 `environment.supportPath` 下的版本化 companion 目录
- **AND** 启动解压后的 companion artifact

#### Scenario: public release unavailable
- **WHEN** 本地未安装当前版本 companion artifact
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
