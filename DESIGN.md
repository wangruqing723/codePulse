# Codex 导入冲突健康检查设计

## 背景

Codex App 的 Claude Code 导入功能会把 `~/.claude/settings.json` 中的 Hook 配置复制到 `~/.codex/hooks.json`。如果其中包含 CodePulse 的 Claude Hook，命令仍会以 `codepulse-hook claude` 运行，导致同一个 Codex 会话同时产生 Codex 与 Claude 状态。

当前工作区已有两层运行时防御，必须完整保留：

1. Hook 脚本根据 transcript 路径中的 `.codex/sessions` 或 `.claude/projects` 修正真实 agent。
2. 状态合并层再次按 transcript 路径和已有会话归一 agent，避免跨 agent 重复。

本次增加第三层配置健康检查，在错误 Hook 产生事件之前发现 Codex 导入冲突，并提供可回滚的显式修复。

## 目标

- 每次读取 Hook 安装状态时，只读检查 `~/.codex/hooks.json`。
- 精确识别从 Claude Code 导入、且会以 Claude 身份调用 CodePulse 的命令。
- 在菜单栏提示冲突，在 CodePulse Center 提供用户确认后的修复操作。
- 修复只删除冲突的 CodePulse command leaf，保留 CodeGraph、Comet、其他 Claude Hook 和未知字段。
- 每次实际修复前创建逐字节备份，并使用独占修复锁、提交前校验和原子替换降低与 Codex App 并发写入的风险。
- 对真正由 Claude Code 委托启动的 Codex 会话保留 Codex 身份，并明确展示委托来源，避免再次与伪 Claude 会话混淆。
- 完成后发布 `0.1.9`，先发布 Companion Release，再发布 Raycast private Store。

## 非目标

- 不阻止 Codex App 执行 Claude Code 导入。
- 不自动删除其他 Claude Code 配置、会话、skills、MCP 或工具。
- 不在 5 秒刷新循环中静默修改用户配置。
- 不改动 `state.ts` 的第三层逻辑；现有运行时双重防御继续作为兜底。
- 不自动清理历史备份。

## 方案选择

### 方案 A：运行时容错 + 显式配置修复（采用）

刷新时只读检测；冲突时展示告警，由用户在 CodePulse Center 确认后修复。优点是不会意外改写导入配置，同时能够持续发现以后再次导入造成的污染。

### 方案 B：刷新时自动修复

发现冲突后立即改写 `hooks.json`。操作最省，但后台刷新会静默修改用户配置，也可能与 Codex App 正在写入配置发生竞争，因此不采用。

### 方案 C：只依赖两层运行时纠错

不会再显示假 Claude 会话，但错误配置会长期存在并持续产生冗余事件，无法解释或预防未来重复导入，因此不足以满足健康检查目标。

## 数据模型与内部 API

在 `src/lib/hooks.ts` 的现有 Hook 配置边界内扩展，不新增外部 API。

```ts
type CodexImportedHooksState = "clean" | "conflict" | "invalid";

interface CodexImportedHooksHealth {
  state: CodexImportedHooksState;
  hooksPath: string;
  count: number;
  eventNames: string[];
  error?: string;
}

interface HookInstallStatus {
  // 现有字段保持不变
  codexImportedHooks: CodexImportedHooksHealth;
}

interface HookInstallOptions {
  // 现有字段保持不变
  codexHooksPath?: string;
}

interface RepairCodexImportedHooksResult {
  status: HookInstallStatus;
  removedCount: number;
  eventNames: string[];
  backupPath?: string;
}
```

新增 `repairCodexImportedClaudeHooks(input)`，输入沿用 `string | HookInstallOptions`，返回修复统计、备份路径和最新状态。

## 检测规则

健康检查严格解析 JSON，并结构化遍历 `hooks[eventName][].hooks[]`。只有同时满足以下条件的 leaf 才算冲突：

- `type === "command"`。
- `command` 调用的可执行文件名为 `codepulse-hook`，允许路径带引号或不带引号。
- `codepulse-hook` 后的第一个 shell 参数是 `claude`。

检测不能依赖当前 Raycast UUID 路径，以便识别旧安装路径；也不能使用整组 `JSON.stringify(...).includes("codepulse-hook")`，否则会误删同组的其他 Hook。

状态语义：

- 文件不存在：`clean`。
- 文件可解析且无匹配项：`clean`。
- 存在一个或多个匹配项：`conflict`，同时返回数量和去重后的事件名。
- 文件无法读取或 JSON 无法解析：`invalid`，返回可展示的错误信息，禁止修复。

## 修复流程

1. 读取原始文本并严格解析；若不是 `conflict`，直接返回且不写盘。
2. 通过 `lstat` 检查 `hooks.json`；若它是符号链接，拒绝自动修复并在错误中给出真实目标路径，绝不以 rename 覆盖链接本身。
3. 只删除匹配的 command leaf；保留同组其他 leaf、`matcher`、其他事件和顶层字段。
4. 仅当 Hook 组除空 `hooks` 外没有 `matcher` 或其他未知字段时才删除该组；否则保留容器。事件数组确实为空时才删除事件键，不重排其他数组内容。
5. 通过 `open(..., "wx")` 获取 CodePulse 专用修复锁。结构有效且 PID 仍存活的锁始终视为活动锁，不因超时被接管；空或损坏的新鲜锁按 `mtime/ctime` 视为初始化中，只有确认 owner 已退出或 invalid 锁已超过保守期限时才隔离并重新竞争。
6. 锁初始化、释放和异常清理同时校验 token、获取时 inode/signature 与当前路径身份；路径属于后来者时宁可保留锁，不盲删。
7. 记录原文件内容与 `stat/lstat` 签名；准备写入前再次校验内容、inode、大小、修改时间和非 symlink 身份，任一变化都中止并提示配置已变化。
8. 在原文件旁使用毫秒时间戳加随机后缀生成备份名，例如 `hooks.json.codepulse-import-20260710-231500-123-a1b2.bak`，并以 `wx` 独占创建；碰撞时生成新名称。备份内容必须与原始文本逐字节一致。
9. 在同目录以独占方式创建临时文件，写入并尽量保留原文件权限；最后一次校验通过后通过 rename 原子替换。
10. 在 `finally` 中清理临时文件和属于当前调用的锁，最后调用 `getHookInstallStatus()` 返回最新健康状态。

任何解析、备份或写入错误都不得破坏原文件。无冲突的重复修复必须幂等，不创建备份。由于 Codex App 不会配合 CodePulse 的锁，跨进程文件系统没有可移植的 compare-and-swap；提交前双校验只能把竞态缩小到最后一次校验与 rename 之间的极窄窗口，不能宣称绝对消除。逐字节备份和两层运行时防御继续承担可回滚与兜底职责。

## UI 行为

### CodePulse Center

在 Floating Companion 项之后、Claude Code/Codex 安装项之前增加 `Codex 导入兼容性`：

- `clean`：显示 `正常` 和 `Icon.CheckCircle`，无操作。
- `conflict`：显示 `N 项需修复` 和 `Icon.Warning`，主操作为 `修复 Codex 导入冲突`。
- `invalid`：显示 `无法检查 hooks.json` 和失败图标，不提供修复操作。

修复前使用 `confirmAlert` 明确说明：只移除 Codex 配置中的 CodePulse Claude Hook，其他导入配置不变，并自动创建备份。成功 Toast 显示删除数量和备份路径，然后刷新状态；失败 Toast 显示原因。

Hook health 与 companion preference、session scan 和 notification 刷新独立执行；任一无关刷新失败都不能阻止冲突告警更新。竞态下已被其他进程清理时显示“无需修复”，变为 invalid 或仍有 conflict 时不得误报成功。

### 菜单栏

5 秒刷新继续调用 `getHookInstallStatus()`。仅在 `conflict` 时于菜单栏操作区显示警告项 `Codex 导入冲突：N 项`，点击打开 CodePulse Center；菜单栏不直接写配置。`clean` 时不增加菜单噪声，`invalid` 的详细处理留在 Center。

### 委托来源标识

Codex transcript 的 `session_meta.payload.originator === "Claude Code"` 时，将可选 `origin` 标记为 `delegated`。菜单与 Companion 仍把它识别为 Codex，只在标签和摘要中显示 `Codex（Claude Code 委托）`、`委托中/委托完成/委托出错/委托待确认`；dominant status 与 count 继续覆盖全部可见会话，并严格保持 `error → waiting → running → done` 的全局顺序。

## 测试策略

### 核心测试

- 识别带引号的当前命令和不带引号的旧路径命令。
- 不匹配 `codepulse-hook codex`、CodeGraph、Comet、普通 Claude Hook 或仅包含相似字符串的命令。
- 混合组中只删除冲突 leaf，并保留 matcher、未知字段、其他 leaf、事件和顶层字段。
- 只有无附加字段的空组才能清理；带 matcher 或未知字段的空容器必须保留。
- 每次实际修复以独占创建方式生成唯一备份，覆盖同毫秒碰撞重试，且备份与修复前文本逐字节一致。
- 无冲突、文件缺失、损坏 JSON 和并发变化路径均不写坏文件。
- 同时触发两个 CodePulse 修复时，只有持有修复锁的调用可以继续；新鲜初始化锁和 live PID 锁不会被接管，崩溃残留锁可以恢复，旧持有者不会删除后来者的锁。
- symlink 配置会被明确拒绝且保持链接与目标内容不变；普通文件在提交前被换成 symlink 时必须中止。
- 返回删除数量、事件名、备份路径和最新健康状态。

### UI 与回归测试

- 导出的 Center 修复 action helper 覆盖确认、成功 Toast、失败 Toast 和刷新行为。
- 菜单栏冲突告警的条件和跳转行为可通过小型纯 helper 测试；组件编译由 Raycast build 覆盖。
- 保留并运行现有 Hook 脚本、状态归一、POSIX/WSL 和同 sessionId 回归测试。
- 覆盖仅 delegated 会话、普通与 delegated 混合严重度顺序、scanner origin、renderer 标签和旧 SessionRecord 兼容。

## 验证与发布

使用 `.nvmrc` 的 Node `22.22.2` 执行：

1. `npm test`
2. `npm run lint`
3. `npm run build`
4. `npm run companion:build`
5. `git diff --check`

发布顺序固定为：

1. 提交功能修复。
2. `npm version 0.1.9 --no-git-tag-version`，同步修正 `package.json` 中残留的 `v0.1.7` 偏好说明并重新 build。
3. 提交版本升级，推送 `dev`，同步并推送 `main`。
4. 执行 `npm run companion:release:mac`，核验 manifest 版本、ZIP SHA-256 和 App bundle 版本。
5. 创建并推送 `codepulse-companion-v0.1.9`，等待 GitHub workflow 成功并核验两个 Release 资产。
6. 执行 `npx ray publish` 发布到 private `code-pulse` Store。
7. 复核远程 Release、Store 版本及 `dev...main = 0 0`。

Companion Release 必须早于 Raycast Store 发布，否则扩展会引用尚不存在的 `0.1.9` manifest。

## 风险控制

- 当前工作区已有未提交的两层防御修改，实现必须增量编辑，禁止覆盖或回退。
- 健康检查不能复用会吞掉解析错误的宽松 JSON reader。
- 对用户目录的修复必须使用独占修复锁、唯一备份、提交前双校验和原子替换；文档与错误提示不得把 best-effort 并发保护表述为绝对保证。
- 发布属于时效性操作，最终结论必须同时核对本地版本/产物和 GitHub workflow/Release/Store 远程状态。
