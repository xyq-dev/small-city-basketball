# UI005 验证摘要

验证时间：2026-11-05（Asia/Shanghai）。

| 检查 | 结果 | 说明 |
|---|---|---|
| `npx playwright test tests/e2e/mini-program.spec.ts --project=desktop --workers=4` | 1386/1386 通过 | 当前原生模板、合成夹具；73 路由、17 状态，320/390/430 三宽 |
| `node scripts/check-mini-layout-evidence.mjs <matrix-results>` | 1386/1386 证据通过 | 守卫同时读取独立 fixture 与 `ui005-state-aliases.json`，核对 PNG、布局 JSON 和长页分段 |
| UI005 与本轮行为直接测试 | 139/139 通过 | 覆盖 73+17 映射、按钮色与尺寸、无合法目标禁用、预约来源透传、公开页、资料/球员、媒体、赛季、球队与报名回归 |
| `npm run test:wechat` | 1207/1208 通过 | 唯一失败见下；未删测试、未跳过、未降低断言 |
| 微信开发者工具只读采集 | 18/18 路由匹配，36 张图，0 异常 | 逻辑 390×844；PNG 355×768；不执行生产写操作 |
| `git diff --check` | 通过 | 使用 `core.safecrlf=false` 避免 PowerShell 把换行提示当作命令错误 |

## Windows 唯一失败

`apps/wechat/test/native-components.test.cjs:165` 在测试搭建阶段调用 `symlinkSync`，Windows 返回 `EPERM`：

```text
EPERM: operation not permitted, symlink '<temp>/external.wxml' -> '<temp>/components/menu/index.wxml'
```

失败发生在创建临时符号链接时，尚未进入“组件不得跟随项目外符号链接”的产品断言。测试保持原样；Draft PR 的 Linux CI 已实际通过该 symlink 用例。Linux 微信测试为 1207 通过、1 个仅 Windows 批处理桥按平台跳过、0 失败。

## Draft PR 首轮 Linux CI 发现与修复

PR #42 首个 head `ca8cf8e5ba8ac0c74eccd7fc579995da399b6efa` 的 admin 作业中，`format:check`、typecheck、`npm test`、build 和 e2e 均成功；e2e 为 1400 通过、1386 个移动项目按配置跳过。后续证据守卫误把 `ui005-event-access-limited` 判为额外输出，因为守卫只枚举独立 fixture，没有枚举 Playwright 已使用的状态别名。

修复后守卫与 Playwright 使用同一份 `ui005-state-aliases.json`，并可显式接收证据目录。本地对本轮 1386 项结果复验通过。

修复 head `aa05715f41d148a872f2c82b48b8f2a79b9842a9` 的 [Application checks 42001388020](https://github.com/xyq-dev/small-city-basketball/actions/runs/42001388020) 全部成功：admin 8m32s（format、typecheck、`npm test`、build、e2e 1400 通过 / 1386 按配置跳过、证据 1386/1386），production 7m，api 25m28s。该结果属于该实现 head；后续纯文档收口提交仍应以 PR 最新检查为准。

## 格式检查边界

仓库全量 `npm run format:check` 在当前 Windows checkout 报告 1043 个文件（包括未改动的 admin/api 和私有配置）换行/格式不匹配，不能在 UI005 中批量改写。UI005 本轮直接修改的 TypeScript、脚本、夹具和关键 JS/测试已单独用 Prettier 检查并通过；提交后的完整结果以 Linux CI 为准。

## 未执行 / 不得外推

- 未做真机、上传、pack、部署、Migration 或生产数据修改。
- 未完成原生键盘画面验收；只执行输入框定位与聚焦。
- 隔离矩阵不是微信真实成功流程；微信只读采集也不代表报名、预约、审核、支付或记分写流程通过。
