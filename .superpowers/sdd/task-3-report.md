# Task 3 Report: Floating Companion View Model And Geometry

## 实现内容

- 新增 `src/companion/view-model.ts`：
  - `buildFloatingViewModel(snapshot, context)`：根据 `StateSnapshot` 和平台上下文生成 companion 视图模型。
  - `statusText(model)`：输出聚合状态文案，覆盖 `WSL 不可用`、等待、运行、完成、空态。
  - `sessionCopyActions(session, context)`：Windows 只提供 WSL 路径和 UNC 路径动作；macOS 只提供本机路径动作。
- 新增 `src/companion/geometry.ts`：
  - `dockWindow(bounds, displayWorkArea, edge)`：把窗口钳到指定边缘并保持在工作区内。
  - `hiddenBounds(bounds, displayWorkArea, edge, visibleSize)`：贴边隐藏时仅保留可见边栏。
  - `revealedBounds(hidden, previousFullBounds, displayWorkArea)`：展开时恢复完整窗口并钳回工作区。
- 新增 `src/companion/state-source.ts`：
  - `resolveCompanionStateSource(platform, options)`：为 `darwin` 产出本地 state source，为 `win32` 解析默认 WSL context 并产出 UNC scan/event roots。
  - WSL 探测失败时返回 `unavailableReason`，不把异常直接抛到 refresh loop。

## RED 命令与失败摘要

- `npm test -- src/companion/view-model.test.ts`
  - 结果：5/5 failed。
  - 摘要：`buildFloatingViewModel`、`statusText`、`sessionCopyActions` 尚未实现，断言收到 `undefined`。
- `npm test -- src/companion/geometry.test.ts`
  - 结果：4/4 failed。
  - 摘要：`dockWindow`、`hiddenBounds`、`revealedBounds` 尚未实现，断言收到 `undefined`。
- `npm test -- src/companion/state-source.test.ts`
  - 结果：3/3 failed。
  - 摘要：`resolveCompanionStateSource` 尚未实现，darwin/win32 分支都未返回 source，WSL failure case 也没有 Promise 结果。

## GREEN 命令与通过摘要

- `npm test -- src/companion/view-model.test.ts`
  - 结果：PASS，5 tests passed。
- `npm test -- src/companion/geometry.test.ts`
  - 结果：PASS，4 tests passed。
- `npm test -- src/companion/state-source.test.ts`
  - 结果：PASS，3 tests passed。

## 测试结果

- Focused rerun:
  - `npm test -- src/companion/view-model.test.ts` -> PASS
  - `npm test -- src/companion/geometry.test.ts` -> PASS
  - `npm test -- src/companion/state-source.test.ts` -> PASS
- 合计：3 个测试文件，12 个测试全部通过。

## 变更文件

- `src/companion/view-model.ts`
- `src/companion/view-model.test.ts`
- `src/companion/geometry.ts`
- `src/companion/geometry.test.ts`
- `src/companion/state-source.ts`
- `src/companion/state-source.test.ts`

## 自审结论

- 实现范围保持在纯函数层与 state source，没有改动 Electron main/renderer、打包脚本或其他禁改文件。
- 复用了现有 `STATUS_LABEL`、`buildStateFromConfig` 输入约定和 `resolveDefaultWslContext` / `toWslUncPath` 能力，没有把 UNC 派生字段写回通用 `SessionRecord`。
- Windows 与 macOS 的路径复制动作边界符合 task brief；WSL 不可用时返回结构化 unavailable state，后续主进程可以据此展示错误态并继续刷新。

## 顾虑

- `vitest` 运行时持续输出 Vite CJS Node API deprecation warning；这不是本任务引入的问题，但后续测试日志仍会带该提示。
- `resolveCompanionStateSource` 当前只显式处理 `darwin` 和 `win32`。若后续 companion 需要支持更多平台，需补明确分支策略。
