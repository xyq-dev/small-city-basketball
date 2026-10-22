# P05-B UI 交接记录

## 上下文与开工历史

- 更新：2026-10-22T16:27:26+08:00；负责人 `/root/p01_ui`，接收人root。
- 目录 `/workspace/scratch/93747c9ad2cb/p05b-admin`；远端 `https://github.com/xyq-dev/small-city-basketball.git`。
- 分支 `feat/P05-public-ui`；开工HEAD `2dd0ba64a20b63cb61919fb1e6e3f3309b5401d7`，除预存node_modules软链接外clean。
- 已完整读取AGENTS、CURRENT_STATUS、TASKS、COLLABORATION及P05-B合同。开工时DTO未就绪、未运行P05-B检查的记录属于历史，已由下述实现与验证替代。
- 按root指令cherry-pick精确合同源 `d34bbc688acbf6e6f21cd64fda3841cc414108da`，本分支为 `7cced4f`；root已整合合同 `fdf75c1`，整合本UI源提交时不重复该合同。
- 本UI已实施、完成本地检查，状态 REVIEW；本次代码提交后 BRANCH_ONLY，尚未MAIN。只写viewing、api/viewing.ts、App/RuntimeApp和本记录；未改任务／汇总／证据／后端或根配置。
- 已授权开发、验证和本地commit；本任务不push、部署、执行Migration或生产操作。

## 已实现范围

- 私有 `/standings`、`/events/:eventId/standings`：完整可见赛事列表、显式胜／负／平积分、可为空的有序同分判定、草稿保存／预览、单独二次发布锁定、当前capabilities控制的公开启用／撤销。
- 积分0必须明确填写，无隐式默认；仅支持净胜分／总得分／胜场数，顺序可调整且无重复。不添加H2H、胜率、净胜封顶或淘汰规则。零确认名次为—，标题“尚无已确认赛果”；共享名次保留1、1、3，未完赛明确暂列，未赛有标记，不称冠军。
- 发布及启停确认携带打开时的rulesetId／expectedEventVersion，不乐观显示成功。API写返回DTO直接应用，失败保输入；撤销成功返回standings:null不清规则或误报失败，可另行刷新榜单。已撤销旧链接不提供恢复入口，再启用以服务端新公开身份为准。
- 匿名 `/watch/:publicEventId`、`/watch/:publicEventId/matches/:publicMatchId`：公开赛事、完整分页赛程、基础比分／时钟、只读按节统计、排名及规则摘要；未准备score／clock／totals为空时显示—，不伪造0，球员专业统计显示未统计。
- RuntimeApp最外层独立分流/watch，不mount私人ApiRuntime、不调用auth/org、不嵌套BrowserRouter。public fetch固定credentials:omit，无私人401回调；机构入口及分享使用整页a导航。App既有邀请fragment／hashchange与Mock逻辑保留，私有和公开新页按需加载，不新增依赖。
- 公开DTO严格递归白名单校验，仅使用publicEventId／publicMatchId／teamKey，未输出内部org/event/match/team/entry/user/roster或人员、确认人、凭据。服务端公开错误不直接展示私密message/details，来源损坏409清内容并显示不可用。
- 每5秒公开轮询，尚未完成的慢请求不会被下一次定时轮询不断中止；URL key／请求generation／卸载保护防旧数据。404清旧赛事及分数，网络失败可留最后快照但标陈旧，offline停止读并提示离线，重连成功后去除陈旧提示。
- raw clock复用scoring/clock纯函数，以原remainingMs／anchor／serverTime加单调elapsed只扣一次；不预扣再二次插值。不提供写分、控制、公开目录、OBS grant、视频或可靠离线能力。
- 所有新select显式稳定aria-label；手机表单16px，主要触控目标44px。长无空格名称可换行，不挤出公开比赛页面。

## 实际验证

| 检查 | 命令／范围 | 结果 |
|---|---|---|
| 全量admin | `npm run test -w @small-city-basketball/admin` | 最终17文件145项通过，保留原125项及新增20项；含原Runtime邀请／上下文回归 |
| 针对新模块 | `vitest run src/viewing` | 3文件20项通过 |
| 入口最终delta | `vitest run src/viewing/PublicPages.test.tsx src/RuntimeApp.test.tsx` | 2文件25项通过；随后全量145再次通过 |
| 严格类型 | `npm run typecheck -w @small-city-basketball/admin` | 通过 |
| 构建 | `npm run build -w @small-city-basketball/admin` | Vite8.3.5通过；新私有／公开页分块，主chunk482.20kB，无大块警告 |
| 格式 | `prettier --check apps/admin/src/viewing apps/admin/src/api/viewing.ts apps/admin/src/App.tsx apps/admin/src/RuntimeApp.tsx` | 全部通过 |
| 差异 | `git diff --check`及暂存后`git diff --cached --check` | 无空白错误，仅指定路径 |

新增回归覆盖私有CAS／草稿必填零值／有序空判定／取消、锁定／启停二次确认、撤销null保规则、capabilities／球队身份、晚save；匿名入口不初始化auth/org、credentials omit、递归拒私有字段、公开错误去私密、分页后页失败、未准备null、零确认及1/1/3、raw clock单扣、URL晚响应、404／来源损坏清屏、网络陈旧／offline恢复、慢轮询和卸载。

首轮新组件测试仅因状态筛选option与可见badge同文而精确text命中两处失败，改为精确badge定位，未放宽表单label。格式首次新测试文件需第二遍Prettier，已修并最终检查通过。初次构建超500kB提示后按需分块本次新路由，最终构建无该警告。

独立reviewer只读复核并执行nativeChromium153合成HTTP布局：发现合法60字符ASCII球队名使公开match390横向撑至1034，已加min-width:0／overflow-wrap:anywhere，复验回到390。reviewer报告普通／长名各6布局及排名tab各2，共16状态均无overflow／截断／pageerror，根证据截图已刷新；这是合成布局证据，不能代替真实API／PG业务验收。最后delta仅按需加载和测试／格式，提交后再请reviewer核对。

## Git与接续

- UI源commit见本提交及root消息；未push。本分支仅node_modules软链接未跟踪。
- root第一步仅cherry-pick本UI源提交，不重复合同7cced4f；随后统一真实API／PG／重启／浏览器／CI及独立最终审查。
- 本负责人未执行真实API／PG／浏览器或Migration；root／reviewer的报告按其证据另记。尚未MAIN／生产，不宣称Safari／微信／OBS／真实视频或生产容量验收。
- 未解决实现阻断：无；规则、正式来源及公开权限由服务端权威判定，源损坏不可伪正常。后续专业统计、可靠离线、OBS等仍另卡。
