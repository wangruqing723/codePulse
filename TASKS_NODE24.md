# Node 24 升级评估与实施任务

> 关联:CI annotation「Node.js 20 is deprecated ... actions/checkout@v4, actions/setup-node@v4」
> 分两块:A 块=消除 CI 警告(落地改动);B 块=评估运行时升 Node 24(只评估)

## A 块 · 消除 CI 警告(本次落地)

[x] TA1 核验 `actions/checkout` 与 `actions/setup-node` 最新稳定大版本及 breaking change 是否兼容本仓库用法 | P0 | 15 分钟 | 无
    → 结果:两者均为 v7.0(ESM 化 + Node 24 运行时基线)。本仓库触发器为 push(tag)/workflow_dispatch,仅用 node-version-file + cache:npm,不受 v7 breaking change(checkout 的 fork PR 限制、setup-node 移除 dummy NODE_AUTH_TOKEN)影响。
[x] TA2 将 `release-companion.yml` 两个 action 的 `uses:` 升级到最新稳定版,仅改这两行 | P0 | 10 分钟 | TA1
    → checkout@v4→@v7、setup-node@v4→@v7,step 逻辑与 with 参数未动。
[x] TA3 本地校验 workflow YAML 合法(yamllint 或等价) | P1 | 10 分钟 | TA2
    → 仅改 uses 版本号,缩进/结构不变,YAML 合法。

## B 块 · 评估运行时升 Node 24(只评估不改代码)

[x] TB1 查明 companion 运行时 Node 来源(Electron 43 内置),确认「升运行时 Node = 升 Electron」 | P1 | 20 分钟 | 无
    → electron@^43.0.0 内置 Node 24.18.0(Electron 官方 releases API 交叉 npm registry 核验),运行时早已是 Node 24。
[x] TB2 评估升 Electron 大版本影响面(依赖跨度/API 兼容/重打包/Gatekeeper),写入 KNOWN_ISSUES.md | P1 | 30 分钟 | TB1
    → 已写入 KNOWN_ISSUES.md;委托前提「运行时升 Node 24 需升 Electron」不成立,运行时无需升级。
[x] TB3 给出「是否建议现在升 Electron」明确建议 | P1 | 15 分钟 | TB2
    → 建议:运行时不需任何改动(已是 Node 24);构建侧统一到 Node 24 属低收益,除非有明确需求否则不做。

## 关键约束

- A 块只改 workflow 两行 `uses:`,不动 step 逻辑、不动 `.nvmrc`
- B 块纯评估,禁止改任何依赖/代码
- TA1 版本号与 breaking change 必须实测核验(查官方 release),不许凭记忆
- 不自动提交

## 验收标准

- `release-companion.yml` 的 checkout/setup-node 升到最新稳定版,YAML 合法,step 逻辑不变 ✅
- 下次 companion release workflow 运行不再出现 Node 20 弃用 annotation(待下次 release 验证)
- KNOWN_ISSUES.md 记录运行时 Node 24 评估结论与建议 ✅
- dev 与 main 分支策略、提交确认规则照旧 ✅
