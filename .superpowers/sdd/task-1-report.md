# Task 1 Report: View Model State Semantics

## 实现内容

- 在 `src/companion/view-model.test.ts` 先添加/更新 focused tests，覆盖四态 summary、error-first 排序、idle 卡片排除、Windows UNC-first 单一复制动作，以及卡片 `displayStatus`、`statusTone`、`contextText`、`durationText`、`displayPath`、`fullPath` 字段。
- 在 `src/companion/view-model.ts` 实现四态 display status 语义：`running`、`done`、`error`、`waiting`，并为卡片派生对应 tone。
- 聚合摘要现在只统计非 idle 的四态卡片，按 `error -> waiting -> running -> done` 输出，并保留 `status`、`count`、`text`，新增兼容性的 `summaryText`。
- `buildFloatingViewModel` 过滤 idle sessions，不再把 idle 渲染为卡片。
- 卡片新增上下文、持续时长、缩短路径、完整路径和单一主复制动作字段；Windows 下复制动作为 UNC 优先，缺少 `wslDistro` 时回退 WSL path。
- 新增字段在 TypeScript 接口上保持可选，以兼容 renderer 测试和旧手写 view model 对象；builder 生成的真实 view model 会填充这些字段。

## RED 证据

命令：

```bash
npx vitest run src/companion/view-model.test.ts
```

失败摘要：

- `summarizes only the four display statuses with error first`：收到旧文案 `出错 1 个`，期望 `🔴 1 错误  🟢 2 运行中`。
- `filters idle sessions out of card display`：收到 2 张卡片，期望过滤 idle 后只剩 1 张。
- `uses one UNC-first copy action on Windows`：收到旧的 WSL + UNC 两个动作，期望单一 `copy-unc-path`。
- `adds context, duration, and shortened path fields to cards`：`displayPath` 为 `undefined`，期望 `~/.../my/plugin-todolist`。

结果：`1 failed` test file，`4 failed | 4 passed` tests。

## GREEN 证据

命令：

```bash
npx vitest run src/companion/view-model.test.ts
```

结果：`1 passed` test file，`8 passed` tests。

额外编译验证：

```bash
npm run build
```

结果：`ray build -e dist` 成功，TypeScript check 通过。

## 变更文件

- `src/companion/view-model.test.ts`
- `src/companion/view-model.ts`
- `.superpowers/sdd/task-1-report.md`

## 自检结果

- 已遵守 TDD：先写失败测试并确认 RED，再实现生产代码。
- 已运行指定 focused 测试并通过。
- 已运行 `npm run build` 并通过。
- 已运行 `git diff --check`，无 whitespace 错误。
- 未修改 renderer、CSS、main、preload、OpenSpec tasks、plan、design doc 或其他 unrelated 文件。
- 未勾选 OpenSpec task，按协调者要求保留给上层处理。
- 未处理既有未跟踪文件 `openspec/changes/refactor-floating-status-viewer/.comet/subagent-progress.md`。

## 顾虑

- `contextText` 当前优先使用 `errorMessage`，否则使用 `title`，最后回退 agent label；brief 只要求非空上下文，没有定义更精确文案。
- `displayPath` 当前对 `/Users/<name>/...` 长路径做 home-aware middle truncation，并保留最后两个 segments；非 macOS home path 暂按原路径显示。
