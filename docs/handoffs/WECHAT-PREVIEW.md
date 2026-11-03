# 微信预览包超限与分包

## 上下文

- 更新时刻（含时区）：2026-11-02 10:43 Asia/Shanghai
- 负责人 / 会话标识 / 接收人：当前修复分支负责人；交给 Codex 复审 Draft PR #38
- 实际绝对目录、仓库远端：`D:\Projects\small-city-basketball`，`https://github.com/xyq-dev/small-city-basketball.git`
- 实际分支 / 基线 HEAD / 当前 HEAD：`fix/wechat-preview-size`。main 基线 `717a3a7a9fbb91aa93370d6dc594c10b58bdf4c9`。本轮开工时审查基线 `148be7343495ee15c7f28ea25290030f150d0b48`；新提交 SHA 以推送后的 PR head 为准
- dirty 与已有他人修改：本轮只改验收工具和三处已确认的跨分包样式。`project.private.config.json` 仍由 `.git/info/exclude` 排除。未跟踪的 `scb-homepage-assets-v1/` 不属于本 PR。stash@{0} 保留
- 任务状态 / 整合状态（LOCAL_ONLY、BRANCH_ONLY、MAIN）：BRANCH_ONLY，Draft，未合并
- commit / push / pack / 部署 / Migration / 生产数据权限分别为：本轮允许 commit、普通 push 和更新已有 Draft PR；不允许生产部署、Migration、生产数据、体验版上传、提审或发布

## 本次完成

- 目标与实际变更文件：保持 6 个主包页和 67 个分包、73 条原路径。验收工具改为读取同一套全量路由。隔离准备的 `overriddenFiles` 改为列出实际改写的 73 个页面脚本。三处跨分包 WXSS 引用已由开发者工具确认失败，共享样式改写进各自页面。
- 需求/API/数据/决策同步位置：未改 API、权限或数据库。同城页继续引用主包 `pages/trade-order/client.js`。
- 分支成果是否已进入 main：否。

## 验证证据

| 检查 | 实际命令或操作 | 环境及提交/工作区 | 结果 | 证据位置 |
|---|---|---|---|---|
| 结构、导航、打包、全量路由和隔离清单 | `node --test` 五个指定测试文件 | Node 24.22.2，提交前工作区 | 107 通过，0 失败 | 本交接 |
| 布局 E2E | `npx playwright test tests/e2e/mini-program.spec.ts --project=desktop` | 本次清空 `test-results` 后重跑 | 1329 通过。73 条初始路由加 370 个 fixture，宽度 320/390/430 | 本地 Playwright。不是微信运行时 |
| 布局证据 | `node scripts/check-mini-layout-evidence.mjs` | 使用上一行本次生成的证据 | 1329 份布局和 PNG 通过 | 命令输出写明 not WeChat runtime |
| 格式与类型 | Prettier `--check` 于改动的 js/cjs/mjs/ts；`tsc --project tsconfig.tests.json` | 同上 | 通过 | 本交接 |
| 空白 | `git diff --check` | 同上 | 仅 CRLF 提示，无空白错误 | 本交接 |
| 微信编译与预览 | 关闭并重新打开工程、清理编译缓存后 `cli preview` | 开发者工具 2.02.2610302 | 预览成功。主包 835.1KB（855190 字节），全部包 2.1MB（2167559 字节） | 工具表格。二维码不是真机验收 |
| 三处样式冷启动 | 自动化 `reLaunch`，未先打开被引用页 | 样式改为页内副本之后 | `local-matchups` 的 `.local-private` 下边距 134px；`local-manage` 的 `.status-banner` 为 rgb(234, 240, 248)；`training-manage` 的 `.title` 为 24px。控制台只有既有的 `enableShareAppMessage` 警告，无异常 | 开发者工具自动化输出 |

测试计划、实际执行、CI 与线上结果分别记录。远端 CI 在推送后的新 SHA 上查看；本交接不引用旧提交的检查结果。

## 样式核查

开发者工具编译日志先确认旧引用失败：

- `../local-bookings/index.wxss` 不能从 `pages/local-matchups/index.wxss` 和 `pages/local-manage/index.wxss` 解析。
- `../training/index.wxss` 不能从 `pages/training-manage/index.wxss` 解析。
- 改到主包 `styles/` 后，相对路径 `../../styles/...` 和绝对路径 `/styles/...` 仍被同一编译器报找不到。官方文档允许分包使用主包资源，但这套开发者工具没有解析成功。

因此把原样式正文放入三个使用页，`local-bookings` 与 `training` 保持原文件。回归要求这些页面不再跨包 `@import`，并保留原有的状态条、标题字号和培训管理附加规则。

## 2026-11-03 公开观赛重开刷新

Application checks `41379255659` 的 api 作业在 `test:api:e2e` 失败：重开后匿名接口已是 `confirmedMatchCount = 0` 且 `REQUIRES_RECONFIRMATION`，观众页在 5 秒内仍没有「尚无已确认赛果」。同一分支上一提交的 api 作业曾在约 4.9 秒擦过该断言。公开页先读赛事再读排名，轮询要等这一轮读完才开始下一次；5 秒才发起的下一次读无法在观众验收窗口内结束。进行中的慢请求仍不中止。轮询改为 2 秒，并增加一条在 5 秒窗口内必须看到「尚无已确认赛果」的检查；改之前该检查失败，改之后 `src/viewing` 76 项通过。本记录不把这次本地结果写成远端 CI。PR 保持 Draft，不合并、不部署。

## 遗留与恢复

- 未完成项 / 阻断原因 / 解除条件：预览二维码不是真机验收。`https://basketball.playhubs.cn` 不在当前 AppID 的 request 合法域名列表；公开赛事路径从本机访问返回 404。这两项与分包和样式分开。没有部署匹配版本的测试 API，也没有关闭域名校验。`pages/account-closure/index.wxss` 对 `../../app.wxss` 的引用不在本轮三页范围内，未单独冷启动。
- 已保存文件 / 未提交工作 / 可恢复点：提交只含验收工具、三页样式和本交接。私有配置与首页素材包留在本机。
- 下一位 AI 的第一条具体操作：阅读 Draft PR #38 与本交接，按新 SHA 复审全量路由、隔离清单和三页样式；不要把主包体积写成全部包体积。
- 接手前必须重新核验的事实：分支、HEAD、PR head 和该提交自己的 CI。
- Migration：不涉及。
- 真实付费服务或生产影响：无。

## Git 与同步结果

- 新提交、目标分支、推送或 API 更新结果：推送 `fix/wechat-preview-size` 后把 SHA 写入已有 Draft PR #38。
- PR / 审查 / main 整合依据：保持 Draft，不合并。
- 若未同步，写明原因及成果位置：`docs/CURRENT_STATUS.md` 与 `docs/TASKS.md` 仍描述已合并事实，本未合并分支不改这两份汇总。
