# C07 球员数据与同价对比证据

2026-10-24 Asia/Shanghai；root。验收对象为`feat/player-reservations`，本节与C06历史证据分开。最终HEAD、远端CI及合并结果在任务卡/交接持续更新。

## 已执行

- 整合API/schema/PG用例后：全项目typecheck、API534源码测试（38文件）通过。新增11项projection用例覆盖当前独立确认、TEAM_ONLY/null、真实0、固定名单校验、重复/损坏与部分数据。
- 整合UI首版dfef5b3后：全项目typecheck、两端build通过；首次全量格式发现`player-performance.test.ts`排版问题，交UI作者修正，不隐藏失败。
- UI作者首版执行11项新增数据/对比/撤销与transport测试，以及16项C06直接回归通过；不是最终全量CI。
- Cloud Chrome桌面实际演示：从广场点击“找同价同位置”，筛出两位¥300控球后卫；加入2/3对比，核对参赛费、10%平台费、交通食宿估算¥330/¥410、5场/3场统计样本及有限记录。详情保留一场真实记录0分，与TEAM_ONLY未统计区别显示。
- 演示中球员撤销青锋杯来源后，重新打开广场及详情显示0统计场次、指标未统计、无近期记录；完成服务数仍为1，未混入比赛统计来源授权。本人显式勾选同意另一邀请赛；管理者精确选择成员/档案并提名新的社区友谊赛，状态保持待本人同意。切平台运营后无管理赛事或授权记录，不能代公开。
- 本轮UI浏览器用合成Mock构建，固定醒目标识；未写真实API或发生资金交易。桌面人工验收不代表手机真机、Safari、微信或服务端授权执行结果。

## 截图

- [同价球员并排对比](player-compare-desktop.jpg)
- [样本、表现及近期记录对比](player-compare-stats-desktop.jpg)
- [个人详情与近期记录](player-records-desktop.jpg)
- [撤销后个人记录隐藏](revoked-records-desktop.jpg)
- [主办方来源提名与授权状态](data-consent-desktop.jpg)

首次fullPage截图协议超时，随后按支持的viewport截图成功；未调整浏览器连接参数或伪造画面。

最终UI增量6664ccd后，全项目typecheck、全量格式、两端build、13项新增直接UI/transport测试通过；此前首版全量前端442项/55文件通过。最终新增2项actor/提名用例已纳入13项直接测试，完整最终全量计数等待CI。独立审查基于6664ccd静态CLEAR，当前范围无新增实质P1/P2，不代替PG执行。

## 尚待联合验证

17项新真实PG/HTTP用例已编写及严格联编，须随最终017/65表代码由隔离CI执行。C06基线远端CI40061888579的真实PG/重启成功、admin与隔离production成功不充作本卡通过；当时api浏览器仍运行。最终CI、必要修复与独立审查见[任务卡](../../tasks/C07.md)及[交接](../../handoffs/C07.md)。没有生产部署、正式Migration、真实资金、通知、实名或资格自动核验。
