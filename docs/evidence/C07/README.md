# C07 球员数据与同价对比证据

2026-10-24 Asia/Shanghai；root。验收对象为`feat/player-reservations`，本节与C06历史证据分开。最终HEAD、远端CI及合并结果在任务卡/交接持续更新。

## 最终验收与合并

2026-10-24 Asia/Shanghai；DONE / MAIN。[PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)已合并main `7d23203c2bfd57f3fd99622f286d30cd2c5d9356`。最终source `1722333d50c077cbf11efc388381c68440873dfe` 与本地 `6c4503d9df7455902e4430e3fcb512e1c92d6b8f` 源tree均为 `24c7ad11055fcc0464babeba2b63aa2b3a230a05`；合并后已只读fetch核验merge tree完全一致，未改原main工作树或reset/force。

最终[CI40065953550](https://github.com/xyq-dev/small-city-basketball/actions/runs/40065953550)三个job全部SUCCESS（attempt1，无重试），原始日志已核对：1046源码（admin512/API534）、微信VM11、289真实PG（含预约32/数据19）＋隔离runtime16、14Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器；17迁移/65表实际重启、完整dump恢复/旧授权隔离及正常/故意失败owned清理通过。

独立最终静态联读CLEAR；最新source自动CodeReview completed且无finding/未解决finding，六条历史P2已在完整真实验证后全部resolved（含2条未outdated），没有靠行失效代替修复。security未运行。六项修复为原买方128配额、全部授权历史可达/重验、原请求跨挂载及刷新恢复、COMMIT后持久拒绝、裁定者排除球队授权关联、未接单请求保留原到期而不能转争议。

016/017已在隔离CI实际执行，生产均未执行。真实个人撮合支付/退款/分账、通知、实名/资格自动核验仍未配置，资金UNAVAILABLE/BLOCKED/0。没有生产部署、正式账号维护或新外部凭据。手机模拟不等于微信/Safari真机；旧001–007完整FINAL数据的隔离升级仍属既有待办。

合并后自动检查尚未取得最终结论，不与候选CI混淆；合并代码tree与已验证候选完全相同。后续仅验收文档同步，文档HEAD以实际Git读取。停止会话后不会无人值守监测。

## 逐段执行与问题修复记录

- 整合API/schema/PG用例后：全项目typecheck、API534源码测试（38文件）通过。新增11项projection用例覆盖当前独立确认、TEAM_ONLY/null、真实0、固定名单校验、重复/损坏与部分数据。
- 整合UI首版dfef5b3后：全项目typecheck、两端build通过；首次全量格式发现`player-performance.test.ts`排版问题，交UI作者修正，不隐藏失败。
- UI作者首版执行11项新增数据/对比/撤销与transport测试，以及16项C06直接回归通过；不是最终全量CI。
- Cloud Chrome桌面实际演示：从广场点击“找同价同位置”，筛出两位¥300控球后卫；加入2/3对比，核对参赛费、10%平台费、交通食宿估算¥330/¥410、5场/3场统计样本及有限记录。详情保留一场真实记录0分，与TEAM_ONLY未统计区别显示。
- 演示中球员撤销青锋杯来源后，重新打开广场及详情显示0统计场次、指标未统计、无近期记录；完成服务数仍为1，未混入比赛统计来源授权。本人显式勾选同意另一邀请赛；管理者精确选择成员/档案并提名新的社区友谊赛，状态保持待本人同意。切平台运营后无管理赛事或授权记录，不能代公开。
- 本轮UI浏览器用合成Mock构建，固定醒目标识；未写真实API或发生资金交易。桌面人工验收不代表手机真机、Safari、微信或服务端授权执行结果。

## 截图

- [同价球员数据卡片](same-price-market-desktop.jpg)
- [同价球员并排对比](player-compare-desktop.jpg)
- [样本、表现及近期记录对比](player-compare-stats-desktop.jpg)
- [个人详情与近期记录](player-records-desktop.jpg)
- [撤销后个人记录隐藏](revoked-records-desktop.jpg)
- [主办方来源提名与授权状态](data-consent-desktop.jpg)

首次fullPage截图协议超时，随后按支持的viewport截图成功；未调整浏览器连接参数或伪造画面。

最终UI增量6664ccd后，全项目typecheck、全量格式、两端build、13项新增直接UI/transport测试通过；此前首版全量前端442项/55文件通过。最终新增2项actor/提名用例已纳入13项直接测试，完整最终全量计数等待CI。独立审查基于6664ccd静态CLEAR，当前范围无新增实质P1/P2，不代替PG执行。

## 尚待联合验证

17项新真实PG/HTTP用例已编写及严格联编，须随最终017/65表代码由隔离CI执行。C06基线远端CI40061888579的真实PG/重启成功、admin与隔离production成功不充作本卡通过；当时api浏览器仍运行。最终CI、必要修复与独立审查见[任务卡](../../tasks/C07.md)及[交接](../../handoffs/C07.md)。没有生产部署、正式Migration、真实资金、通知、实名或资格自动核验。

## 审查后增量

原C07 source4df2c532的CI40062592812已三job全部SUCCESS、无重试：978源码、VM11、279PG（含新17）＋runtime16、14Mock/24真实API/4HTTPS浏览器、17迁移/65表重启与完整恢复、旧授权隔离/owned清理。自动审查随后提出的3项P2已按配额、完整授权分页、未知建单恢复分别修复；不能用该基线成功替代修复后验证。

修复后root API534源码通过；最后tombstone前完整admin492/57文件通过；最终092c3b9全类型、全格式、两端build、50项建单恢复组件/store测试通过。最后4项新增已在50项直接测试执行，最终全量计数以新CI为准。新增配额2PG、分页2PG，数据用例合计19；这些新4项仍待修复后完整CI。静态配额/分页/共享在途与storage逐段复核记录见交接，最终UI小delta复核待汇总。

最终092c3b9独立全delta静态CLEAR，三项修复范围无未解决P1/P2。root重建内部Mock预览后，再次走同价统计卡片、切球员进入数据授权、操作前单条重验打开撤销框并返回；正常工作，未写真实API。最终数据卡片截图已更新。完整新候选CI仍待，不以此替代真实PG或API浏览器。

后续source1bf31fde的admin/隔离production通过，但自动review新增wO0终态拒绝问题。API99bf6e8＋UIcf34dba已修，源码及4新增PG静态联读CLEAR；最终root全项目类型/格式/npm test/build通过：1039源码（505/534）、VM11。新增预约4PG后该文件30项，数据19项；新完整CI待验证这些增量，不拼接旧source结果。新逻辑保存不可变拒绝，实际COMMIT失败不会给终态marker，覆盖由owned deferred trigger故障验证的用例计划。
