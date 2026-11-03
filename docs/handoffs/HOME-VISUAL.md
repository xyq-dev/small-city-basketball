# 首页视觉还原

## 上下文

- 更新时刻（含时区）：2026-11-02 10:55 Asia/Shanghai
- 负责人 / 会话标识 / 接收人：当前首页分支负责人
- 实际绝对目录、仓库远端：`D:\Projects\small-city-basketball`，`https://github.com/xyq-dev/small-city-basketball.git`
- 实际分支 / 基线 HEAD / 当前 HEAD：`fix/wechat-homepage`，从包体提交 `148be7343495ee15c7f28ea25290030f150d0b48` 分出。首页实现仍是 `2fec46a4838aeda55c8a1d5a126a5e392d68eae7`。本轮只收紧首页首屏间距并补上参考图里的示意说明，HEAD 以推送后的分支为准
- dirty 与已有他人修改：包体分支 `fix/wechat-preview-size` 和 Draft PR #38 未混入。高清母版目录 `scb-homepage-assets-v1/` 仍未跟踪。`apps/wechat/project.private.config.json` 继续由 `.git/info/exclude` 排除
- 任务状态 / 整合状态（LOCAL_ONLY、BRANCH_ONLY、MAIN）：实现完成后为 BRANCH_ONLY。未合并，`docs/CURRENT_STATUS.md` 未改写成 main 事实
- commit / push / pack / 部署 / Migration / 生产数据权限分别为：沿用既有开发提交、普通 push 和 Draft PR 授权。本轮没有预览上传、发布、部署、Migration 或生产数据操作

## 本次完成

- 目标与实际变更文件：微信首页按素材包参考图重排。运行图在 `apps/wechat/assets/home/`，页面在 `pages/home`，底部五个导航改用素材包 SVG。同城页只增加已有 `kind` 查询，使找球场、约裁判沿用现有筛选。
- 需求/API/数据/决策同步位置：公开赛事仍走现有目录接口。目录没有封面字段，卡片左侧使用素材包球场图并标明“示意图”。没有把参考图里的合成赛事项写入正式列表。
- 分支成果是否已进入 main：否。

## 验证证据

| 检查 | 实际命令或操作 | 环境及提交/工作区 | 结果 | 证据位置 |
|---|---|---|---|---|
| 首页、导航、公开赛事、同城和打包规则 | `node --test` 七个直接相关测试文件 | Node 24.22.2，本轮间距调整后的工作区 | 57 通过，0 失败 | 本交接 |
| 格式 | Prettier `--write` 后再次 `--check` 由测试前的写入保证；写入后的测试通过 | 同上 | 被改动的 js、cjs、json 已按 Prettier 写回 | 本交接 |
| 三宽与空态 | 原生 WXML/WXSS 兼容预览 320、390、430，以及 390 空列表 | 2026-11-02 本轮工作区，静态预览，不是开发者工具或真机 | 390 首屏在含 24px 底部安全区的底栏之上能看到两张服务卡和“效果示意”说明。320、430 没有横向溢出。空列表仍显示“查看全部赛事”“切换城市”。主按钮“发现赛事”高 44px | 本地预览。参考图没有被替换 |
| 运行包新增体积 | 统计 `apps/wechat/assets/home` | 工作区文件字节 | 293601 字节。图标和场馆插画保持 RGBA。未重新执行开发者工具上传测量 | 本交接 |

测试计划、实际执行、CI 与线上结果分别记录。微信真机、完整回归和远端 CI 本轮未执行。上次主包 885211 字节是包体提交的工具测量，不含本轮图片，不能把 293601 直接写成新的工具结果。

## 遗留与恢复

- 未完成项 / 阻断原因 / 解除条件：没有声称与参考图逐像素一致。公开赛事没有封面字段，卡片左侧仍是标明“示意图”的素材图。空列表时“同城篮球服务”标题会碰到底栏，服务卡需要向下滚动。底部安全区在静态预览里按组件初始 24px 计算，真机安全区更大时说明文字会更靠近底栏。开发者工具本轮没有重新冷启动首页。包体分支上的验收工具提交不在本分支。
- 已保存文件 / 未提交工作 / 可恢复点：高清母版、参考图和说明留在未跟踪的 `scb-homepage-assets-v1/`，没有打进小程序目录。
- 下一位 AI 的第一条具体操作：先核验本分支 HEAD 与 PR，不要把首页提交加进 PR #38。
- 接手前必须重新核验的事实：开发者工具工程仍是 `D:\Projects\small-city-basketball\apps\wechat`，`miniprogramRoot` 为 `./`。
- Migration：不涉及。
- 真实付费服务或生产影响：无。

## 2026-11-03 账号夹具底栏图标（BRANCH_ONLY）

- 更新时刻（含时区）：2026-11-03 09:08 Asia/Shanghai
- 负责人：当前首页分支会话。目录 `/workspace`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `fix/wechat-homepage`。开工 HEAD `b1e6c9f2c27cd60563fde24fbf62d239bb003c9e`，工作区当时干净。
- 原因：Draft PR #39 的 [Application checks 41380353519](https://github.com/xyq-dev/small-city-basketball/actions/runs/41380353519) 里 admin `npm test` 为 1190 通过 / 1 失败。`apps/wechat/test/c10-account.test.cjs` 只放行 `approved-ui` 图标和 `ui002` SVG，已登录账号夹具的共享底栏实际加载 `assets/home/home.svg`、`trophy.svg`、`pin.svg`、`team.svg`、`profile-active.svg`。这五个文件是首页还原时换上的底栏图标，不是账号页肖像或其他首页素材。同一提交已经在 `c10-public.test.cjs` 用同一条导航正则放行。22 个账号夹具里，7 个已登录账号页只有这五个文件，其余 15 个没有额外首页素材。
- 变更：只改账号夹具断言。底栏五个图标及其选中态仍可出现；`assets/home/` 下的其他文件（主视觉、品牌标、球场图、服务插画等）仍会使该断言失败。导航组件和首页页面没有改回旧图标。
- 本地验证：Node v22.23.4，`npm test` 退出码 0。admin 588、api 1339、微信源码 1191 通过，1 项既有 Windows 跳过，0 失败。当时未跑 `test:e2e`。
- 远端 CI：`a9d1a0d` 的 [Application checks 41557841240](https://github.com/xyq-dev/small-city-basketball/actions/runs/41557841240) 中，api 与 production 成功。admin 的 `npm test` 成功：admin 62 个文件、api 116 个文件、微信 1191 通过 / 1 项既有 Windows 跳过 / 0 失败。同一 admin 作业随后在 `npm run test:e2e` 失败，149 通过 / 993 失败 / 1128 跳过。首个失败是首页静态布局把顶栏高度期望写成 84，实际没有该度量；其余大量失败是夹具路由不在 `app.json` 主包 `pages` 的 6 条里，而在分包。这次没有改 e2e 或分包。未部署，未执行 Migration。
- 状态：BRANCH_ONLY。未合并。`CURRENT_STATUS.md` 仍只记录已合并事实。
- 下一位 AI 的第一条具体操作：先读本提交的 Application checks。admin `npm test` 在 `a9d1a0d` 已通过；`test:e2e` 的 993 项失败由后续提交处理，不要并入 PR #38，不要合并 #39。

## 2026-11-03 布局 e2e（BRANCH_ONLY，远端未记）

- 更新时刻：2026-11-03 11:20 Asia/Shanghai 左右。目录 `/workspace`，分支 `fix/wechat-homepage`。
- 原因：`383dcd2` 的 Application checks 41561602746 里 admin `npm test` 通过后，`npm run test:e2e` 为 149 通过 / 993 失败 / 1128 跳过。失败集中在两类：首页没有 84px 的 `scb-header`；夹具路由在分包，而断言只查主包 6 页。
- 变更：主包加分包才算已注册路由，与 `native-structure` 和预览一致。首页几何改到素材包首屏（无共享顶栏，320 宽英雄区 180px，更宽为 188px，底栏高 80px）。消息按钮用更具体的 44px 宽度，分段标题按钮最小高度改为 44px。没有把页面移回主包，没有恢复旧顶栏。
- 本地：Node v22.23.4。`npm test` 退出码 0，微信 1193 通过 / 1 项既有 Windows 跳过 / 0 失败。桌面 `mini-program.spec.ts` 1128 通过，证据脚本 1128 组通过。主办方与球员 e2e 14 通过。移动端小程序矩阵按原配置跳过。这些不是远端 CI。
- 状态：BRANCH_ONLY。未合并，未部署，未执行 Migration。

## 2026-11-03 rebase 到含 #40 的 main（BRANCH_ONLY，远端 CI 未记）

- 更新时刻：2026-11-03。目录 `/agent/repos/small-city-basketball`，分支 `fix/wechat-homepage`，远端 `origin`。rebase 前 HEAD `c17dec37262d637233d1673fe451fc1436c010c5`。`origin/main` 为 `73db92c8f0dfc3d5ca8086a5fd4044e442502e07`（PR #38 的合并提交 `e770803` 之上，另有 squash 合入的文档 PR #40）。工作区当时干净。
- 原因：GitHub 把本分支更新到 main 时，与 #40 的文档更正冲突。#38 已合并，#39 在该次文档核验时仍是开放 Draft。首页几何必须留下。空列表「同城篮球服务」碰底栏不在本轮。
- 冲突文件：`docs/TASKS.md`（首页任务段与 main 的合并状态表叠在一起）；`scripts/check-mini-layout-evidence.mjs` 和 `tests/e2e/mini-program.spec.ts`（首页分支自带的路由拼接，与 main 已抽出的 `registered-routes.cjs` 叠在一起）。
- 做法：rebase 到 `origin/main`，不新开 PR，不合并，不部署。文档保留 main 上 #37/#36/#38 已合并、#39 仍为 Draft 的事实；上表里 #39 的 Application checks 仍只属于 `205ea41`。布局脚本用 main 的共享路由表，初始场景覆盖分包。首页断言保留无共享顶栏、英雄区 320 宽 180px / 更宽 188px，以及带路由说明的 `routes` 包含检查。产品文件与 `c17dec3` 一致。没有改首页标记、样式或素材，也没有改空列表底栏重叠。
- 检查：既有 `home-layout-guard` 会在初始场景退回六个主包页、或首页几何被写成共享 84px 顶栏时失败。rebase 解决后该守卫通过，没有另写一条当前会失败的产品检查。Node v22.23.4，`node --test apps/wechat/test/*.test.cjs tests/wechat-tools/devtools-ui.test.mjs` 为 1194 通过 / 1 项既有 Windows 跳过 / 0 失败。没有安装依赖，没有重跑 e2e。这不是远端 Application checks，也不是真机。
- 状态：BRANCH_ONLY。#39 仍未合并。未部署，未执行 Migration。
- 下一位 AI 的第一条具体操作：读 rebase 之后新 HEAD 的 Application checks。那次远端检查未绿之前，不要把本 PR 写成已通过，不要合并。

## Git 与同步结果

- 新提交、目标分支、推送或 API 更新结果：rebase 后的 `fix/wechat-homepage` 需要 force-with-lease 推到 `origin/fix/wechat-homepage`，因为提交已改写。只推这一条分支。目标仍是更新 [PR #39](https://github.com/xyq-dev/small-city-basketball/pull/39)，不新开 PR。
- PR / 审查 / main 整合依据：PR #39 目标 `main`。未合并进 main。
- 若未同步，写明原因及成果位置：高清母版目录仍只在本地，未提交。空列表「同城篮球服务」碰底栏未改。
