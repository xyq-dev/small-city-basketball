# 本地开发与验证

更新：2026-10-22（Asia/Shanghai）。适用范围：P01 机构后台 Mock 原型。

## 先确认代码交付位置

P01 当前在本地分支 `feat/P01-organizer-console`，基线 HEAD 为 `daea629079bfabc5e77407ae58b50b4af01c1e20`，业务代码及验证配置仍是未提交改动，交付位置为 **LOCAL_ONLY**。远端 `main` 目前只有文档和设计图，不能从该分支克隆后直接执行下面的应用命令。

接手时先核验实际目录、分支、HEAD、dirty 和任务交接记录。只有拿到包含 `package.json`、`package-lock.json`、`apps/admin` 和测试配置的完整代码快照，或代码获得授权并同步后，才进入以下步骤。不要用旧聊天中的路径推定用户电脑目录，也不要覆盖本地未提交实现。

## 环境与安装

本轮验证环境：Node `24.19.0`、npm `11.9.0`。根 `package.json` 声明 Node `>=22.12.0`；这不代表已对所有满足下限的版本逐一验证。当前优先沿用 Node 24，CI 草案也配置 Node 24。

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

预览只在本机提供静态构建，不等于部署。当前没有真实服务器授权、持久化或生产可用性保证。

## 端到端验证

标准安装路径：

```sh
npx playwright install chromium
npm run test:e2e
```

Linux CI 草案使用 `npx playwright install --with-deps chromium`。`playwright.config.ts` 会在 `127.0.0.1:4173` 启动开发服务器；本地允许复用已有服务器，运行前应确认占用此端口的是同一代码快照，避免测到旧页面。桌面和移动两个项目都使用 Chromium；移动项目是 iPhone 13 尺寸及输入方式模拟，不能算作 Safari 或真机验收。

本轮环境中 Playwright 默认 Chromium `151` 下载被代理返回无效 ZIP，标准下载路径未成功。为完成当前验证，使用仓库外的 QA Chromium `153.0.8010.0`，通过配置已有的 `PLAYWRIGHT_EXECUTABLE_PATH` 指向该可执行文件，E2E 12/12 通过。该覆盖仅供受限环境下明确核验的本地浏览器使用，不能替代默认官方浏览器的兼容性证明；项目依赖及锁文件没有引入 QA Chromium。

后续环境应优先使用上面的 Playwright 官方安装命令，不复制本机临时浏览器路径。若下载仍失败，记录错误和环境，不能把未安装视为测试通过。截图与失败 trace 位于测试输出目录；完整证据及本轮额外截图位置见 [P01 交接记录](handoffs/P01.md)。

## 后续接入边界

P02–P06 尚未实现；真实 API、认证、机构隔离、数据库、Migration、记分同步、OBS 和云直播均不在当前本地运行链路中。后续按 [任务看板](TASKS.md) 逐项推进，不为启动 P01 提前搭建这些服务。
