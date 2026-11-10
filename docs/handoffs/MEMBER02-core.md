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


## 契约补充与预审

root及独立MEMBER02审查者已确认本模型可进入实现，不代表代码/PG验收。workspace增加organizationName（真实机构名/platformnull）及historyTruncated.plans；四类目录均最多100条，资格和余量另读完整相关事实，不从历史列表推断。会员报价validDays与durationDays相等，前者仅兼容商业报价，UI应按durationDays展示购买期。

新controllers导出OrgSoftwareMembershipController与PlatformSoftwareMembershipController，仍注入原SCB_COMMERCE_SERVICE。新表只有software_membership_periods（SELECT/INSERT/UPDATE，UPDATE仅原成功退款撤销）；实际新增函数为m02_membership_order_insert_guard()和m02_period_guard()，均仅trigger、无runtime EXECUTE。早期提议的单独plan trigger无需创建，plan固定映射由CHECK及应用验证保证。


## 2026-11-10 16:11 Asia/Shanghai 核心代码检查点

052及单购买期表/原activation消费来源已编写，未执行。service新入口已复用原付款/退款/回调逻辑，member所有order路径统一orgSHARE→mutex→order，event null不拿赛事锁；publish原txn按届优先与会员fallback扣1届，原workspace过滤member类型且不再展示会员已激活赛事为可采购。新controllers同CommerceService，原对账全ledger不改。

首次完整源码126文件1452项中1450通过、2失败都因本作者scope外root manifest/readiness仍固定51，未改旧验收绕过；实际新Migration52导致预期差异，root需按真实新表/2函数/列ACL接线。本地没有真实PG，不标Migration/PG通过。单独直接commerce回归/tsc在执行，后续以完成输出为准。旧C05 test因nullable合同增加明确event非空断言，没有删改业务预期。


## 2026-11-10 16:28 Asia/Shanghai 高风险复审修复与关单

静态审查已修两DDL问题：052固定套餐CHECK多右括号（5aba1a9）、撤销reason=NULL在PG CHECK三值逻辑下放行（6096470显式NOT NULL）。会员mutex key统一小写UUID，route大写与DB UUID同一把锁。支付窗口按DB权威时刻重检：Native可接受订单创建同秒的秒精度success_time，不能接受上一秒；人工付款/DB确认跨expires拒绝，052period guard同步保护，旧EVENT支付window未顺改。原EVENT UNKNOWN交易在会员fallback的DBguard也明确阻断。

经root批准新增CLOSE_NATIVE（合同9d13fca），复用原buyer command、支付SDK与操作回执。先查原单SUCCESS走原settle且不关；只有NOTPAY才发固定原交易关单，再查已验签CLOSED才保存原payment_notifications证明并将原单CANCELLED，保留Native channel；204仅确认请求、UNKNOWN/PAYERROR/REVOKED不释放。该明确已验签CLOSED路径同时覆盖EVENT/MEMBER，防旧按届关闭后转会员永久阻塞。DB订单guard要求Native新转CANCELLED具有同order/kind/固定closed ID的原不可变proof；原终态/报价/已付款守卫不变，不新增任何闭单字段/表/ACL。未接入自动扣费或真实商户。

依据本轮读取微信官方Native文档https://pay.wechatpay.cn/doc/v3/partner/4012759714，CLOSED为已关闭，REVOKED/PAYERROR仅付款码返回；因此不把后两者当Native可重购证明。SDK只对close验签204空body给ack，其余方法仍严格JSON，不把HTTP204当关闭成功。97/97直接commerce源码/合成RSA协议测试通过，API tsc、相关格式/diff通过；初次SDK中间态closeNoContent参数未同步导致源码失败，修正后同4文件全部97通过。真实PG16例由独立作者e0ea277提供，未在本机运行，新增关单/会员Native callback真实PG加签名fixture另在编写；不存在真实支付验收或052已执行主张。

## 2026-11-10 隔离PG preflight失败后的最小语法修复

root回报PR54 f4eb、CI42785246811的api129724709734及account门禁均在052编译失败：42601、position9090、syntax error at end of input，未成功执行052。精确位置落在m02_period_guard支付窗口的IF内CASE；改为`IF NOT (CASE ... END) THEN`，明确CASE表达式边界，防PLpgSQL将内部THEN当IF结束。仅改052这两行及本交接，不动001–051或shared文件；本机仅完成diff/结构核查，真实PG重跑待root新headCI，不能把97项源码测试当Migration通过。
