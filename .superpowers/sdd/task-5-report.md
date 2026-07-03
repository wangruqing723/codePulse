# Task 5 Report: Build + Lint Fix

## 修了什么

- 修正 `src/companion/state-source.test.ts` 中 `vi.fn` 的错误泛型写法：
  - 从 `vi.fn<[], Promise<WslContext>>()`
  - 改为 `vi.fn<() => Promise<WslContext>>()`
- 对 `npm run lint` 点名的文件执行纯 Prettier 格式化，未引入行为改动：
  - `src/companion/geometry.ts`
  - `src/companion/main.ts`
  - `src/companion/state-source.test.ts`
  - `src/companion/state-source.ts`
  - `src/companion/styles.css`
  - `src/companion/view-model.ts`
  - `src/lib/scanners.test.ts`
  - `src/lib/state.test.ts`
  - `src/lib/state.ts`
  - `src/lib/wsl.test.ts`
  - `src/lib/wsl.ts`

## RED / GREEN 证据

- RED（修复前）：
  - `npm run build`
  - 结果：FAIL
  - 关键错误：`src/companion/state-source.test.ts(23,44): error TS2558: Expected 0-1 type arguments, but got 2.`
- RED（修复前）：
  - `npm run lint`
  - 结果：FAIL
  - 原因：Prettier 点名 11 个文件存在格式问题
- GREEN（修复后）：
  - `npm run build`
  - 结果：PASS
  - 关键输出：`info  - checked TypeScript` / `ready  - built extension successfully`
- GREEN（修复后）：
  - `npm run lint`
  - 结果：PASS
  - 关键输出：`ready  - run ESLint` / `ready  - run Prettier 3.9.4`

## 运行过的命令与结果

- `npm run build`
  - 第一次：FAIL，报 `TS2558`
- `npm run lint`
  - 第一次：FAIL，Prettier 点名 11 个文件
- `./node_modules/.bin/prettier --write src/companion/state-source.test.ts src/companion/geometry.ts src/companion/main.ts src/companion/state-source.ts src/companion/styles.css src/companion/view-model.ts src/lib/scanners.test.ts src/lib/state.test.ts src/lib/state.ts src/lib/wsl.test.ts src/lib/wsl.ts`
  - PASS，完成机械格式化
- `npm run build`
  - 第二次：PASS
- `npm run lint`
  - 第二次：PASS

## 改动文件

- `src/companion/state-source.test.ts`
- `src/companion/geometry.ts`
- `src/companion/main.ts`
- `src/companion/state-source.ts`
- `src/companion/styles.css`
- `src/companion/view-model.ts`
- `src/lib/scanners.test.ts`
- `src/lib/state.test.ts`
- `src/lib/state.ts`
- `src/lib/wsl.test.ts`
- `src/lib/wsl.ts`
- `.superpowers/sdd/task-5-report.md`

## 顾虑

- 无行为层顾虑；除 `state-source.test.ts` 的类型修正外，其余改动均为 Prettier 机械格式化。
