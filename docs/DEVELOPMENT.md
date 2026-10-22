# 本地开发与验证

更新：2026-10-22（Asia/Shanghai）。适用范围：P01 机构后台 Mock 原型。

## 已整合代码与接手基线

P01 代码提交为 `819818d2f9fcee972f4c2e7854800dc6ad2415bf`，任务分支 `feat/P01-organizer-console` 已推送；[PR #1](https://github.com/xyq-dev/small-city-basketball/pull/1) 已合并，`main` 整合提交为 `f15adb456c24302ce3d41587c41301e4c3931c6c`。状态 **DONE / MAIN**，仓库已包含应用、锁文件和验证工作流，可克隆运行。

在自己选定的父目录执行：

```sh
git clone https://github.com/xyq-dev/small-city-basketball.git
cd small-city-basketball
git switch main
```

这是私有仓库，使用已获授权的 GitHub 身份和本机凭据；不要把凭据写进远端 URL 或聊天。已有 checkout 不重复克隆、覆盖或强制切换；先核验实际目录、分支、HEAD、dirty 和任务交接。上面的 SHA 是 P01 可复现基线，不是未来永远不变的最新 HEAD。

本轮文档更新的根工作区已核验为 `feat/P02-foundation@e30bd20`，含 P02 契约初稿；后端与前端接入正通过独立 worktree 开发，尚未验收。运行稳定的 P01 时以已整合的 `main` 为准，不将活跃 P02 分支当作已交付成果。

## 环境与安装

本轮验证环境：Node `24.19.0`、npm `11.9.0`。根 `package.json` 声明 Node `>=22.12.0`；这不代表已对所有满足下限的版本逐一验证。当前优先沿用 Node 24，已执行的 CI 使用 Node 24。

在实际项目根目录执行：

```sh
npm ci
npm run dev
```

浏览器打开终端实际输出的本地地址。需要固定端口时，可使用当前真实存在的 workspace 脚本：

```sh
npm run dev --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 5173 --strictPort
```

P01 不需要 `.env`、API Key、数据库或后端服务。不要为运行演示填写真实参赛者资料。当前数据仅保存在内存，不写入 localStorage；刷新后恢复初始演示数据。

## 页面与操作检查

| 页面 | 路由 | 当前可用行为 |
|---|---|---|
| 工作总览 | `/` | 演示指标、示例赛事、创建入口与规划模块入口 |
| 赛事列表 | `/events` | 名称搜索、状态组合筛选、清空筛选、进入详情 |
| 创建赛事 | `/events/new` | 必填、日期与长度校验，保存 DRAFT 草稿 |
| 赛事详情 | `/events/{id}` | 展示本次演示记录；DRAFT 可进入编辑并保存新版本 |

先创建一届赛事，再核对详情、编辑及列表结果是否一致。取消创建/编辑应不保存未提交输入；不存在的赛事应给出恢复入口。新建记录刷新后消失属于已说明的内存演示行为，不是数据库写入失败。初始化的进行中/报名中赛事为合成数据，当前不提供真实状态流转。

报名、排赛、人员权限、记分、支付、保险、直播与 OBS 页面目前为规划说明，不能据此认定相应服务已接通。服务失败与重试通过组件测试中的可注入 repository 验证，未增加面向真实用户的故障开关。

## 本地检查命令

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

生产构建输出到 `apps/admin/dist`。如需查看构建结果，先完成 build，再执行：

```sh
npm run preview --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 4173 --strictPort
```

预览只在本机提供静态构建，不等于部署。用户已授权项目范围内的开发及发布操作；当前尚无已验证的真实服务器部署、持久化或生产可用性。

## 端到端验证

标准安装路径：

```sh
npx playwright install chromium
npm run test:e2e
```

已通过的 Linux CI 使用 `npx playwright install --with-deps chromium`。`playwright.config.ts` 会在 `127.0.0.1:4173` 启动开发服务器；本地允许复用已有服务器，运行前应确认占用此端口的是同一代码快照，避免测到旧页面。桌面和移动两个项目都使用 Chromium；移动项目是 iPhone 13 尺寸及输入方式模拟，不能算作 Safari 或真机验收。

远端 [Application checks run 39728632742](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742) / [job 119658281781](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742/job/119658281781) 已成功完成官方 Chromium 安装和 E2E 12/12；不依赖 QA 浏览器替代路径。

历史本地验证曾因代理返回无效 ZIP 而未能下载默认 Chromium `151`，随后用仓库外 QA Chromium `153.0.8010.0` 和 `PLAYWRIGHT_EXECUTABLE_PATH` 完成12项 E2E。保留该限制用于解释旧证据，不再作为官方路径未通过的当前结论。项目依赖与锁文件没有引入 QA Chromium。

后续环境应优先使用上面的 Playwright 官方安装命令，不复制本机临时浏览器路径。若下载仍失败，记录错误和环境，不能把未安装视为测试通过。截图与失败 trace 位于测试输出目录；完整证据及本轮额外截图位置见 [P01 交接记录](handoffs/P01.md)。

## 后续接入边界

P02 已进入 IN_PROGRESS，当前根分支包含会话与机构基础契约；真实后端、认证、机构隔离和数据库仍未完成验收。P03–P06 尚未实施；Migration、记分同步、OBS 和云直播不在 P01 的运行链路中。后续按 [任务看板](TASKS.md) 逐项推进，不为启动 P01 提前搭建这些服务。
