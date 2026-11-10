# MEMBER02 核心作者交接

2026-11-10 Asia/Shanghai；/root/membership_core；IN_PROGRESS / LOCAL_ONLY。

独立目录 `/workspace/scratch/dc6a786e1a31/scb-member02-core`，分支`feat/MEMBER02-core`，基线`ac6f700f19beaa0ad3128b886fb0fb639633fcc6`，开工干净。root负责共享index/app/manifest/恢复与CI，作者独占commerce后端、新会员contracts、052、直接测试。保留旧checkout。无生产、真实资金、外部凭据或公网操作；Migration仅准备编写。

## 冻结候选契约

`packages/contracts/membership.d.ts`为新API，原CommerceOrderData.eventId诚实扩为string|null；旧按届workspace只返回EVENT数据，会员订单无虚拟赛事。会员quote才增加scope/tier/durationDays/eventLimit/previousPeriodId，旧EVENT报价/JSON/hash不变。

GET `/v1/orgs/:orgId/software-membership`与`/v1/platform/software-membership`返回SoftwareMembershipWorkspaceData；POST机构`/orders`接CreateSoftwareMembershipOrderInput；机构及平台`/orders/:orderId/commands`沿用既有购买者/平台命令并返回SoftwareMembershipCommandResult；平台`/plans`创建新会员不可变版本，`/plans/:planId/commands`沿用上下架CAS。共用原商业支付和总账，不新造支付状态。

仅一张新购买期表software_membership_periods；原event_commercial_activations新增MEMBERSHIP+membership_period_id，原event主键及immutable guard直接作为不可变消费分配账本，不另造第二套赛事/分配事实。DTO allocations由该表投影。最终表/函数ACL和锁序待高风险独立预审确认，未将候选设计写成已通过。

会员同机构mutex在原org锁之后、member order/period行锁之前；publish已持event后取mutex，会员订单event_id=null路径不得再锁任何event；旧EVENT路径不取新mutex。退款/回调/网络返回二次事务同入口，禁止SHARE→UPDATE升级。实际操作仍遵守原order→period次序，最后一额度在mutex和原publish事务中重检并扣一次。

专业30天3届/365天36届（16/128）；商业30天10届/365天120届（32/512）。周期按固定秒，年额不按月发放。会员activated表示已消耗至少1届，非已生效。已买按届优先且不足时不暗吃会员。续费同级同周期、结束前30天、仅一个下一期，下一期未到不能借额度；parent存在有效child时不能退款。无人值守扣款/自动续费不实现。

当前只有契约草案和读审查，没有业务实现、单测、PG/CI或Migration执行通过声明。
