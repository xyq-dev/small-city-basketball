# R6TRAIN 成人培训招生实现

状态：IN_PROGRESS；integration：LOCAL_ONLY。2026-11-01 Asia/Shanghai。
负责人：/root/implement_training；集成人：/root。
目录：/workspace/scratch/aad368826b09/scb-six-training；远端：https://github.com/xyq-dev/small-city-basketball.git；分支work/r6-training；基线c61ab3667c9d3f756244a28046b9ee2395ccac00，开工clean。

范围：培训专项T0/T1的持久课程、审核、排课、席位/候补、独立培训交易源接口、签到授课、消费复核/异议、请假补课退款及原生入口。青少年正式招生与课包保持关闭，不伪造假赛事或真实支付。
允许路径：training-*源/测试、contracts/training、046迁移、training页面和utils/tests、此卡和同名交接。root负责共享API注册、trade源、双向共享日历与路由菜单；不改历史迁移。可本地commit，GitHub同步由root负责；禁止生产与真实外部资金/消息。

计划验证：定向domain/service单测，类型检查，原生页VM，真实PG集成测试编写后交隔离CI。当前尚未执行；046已开始编写、未执行。

2026-11-01 检查点 1：已实现 046 持久表/防篡改触发器、机构/教练独立审核、课程排课、库存与 FIFO 候补、冻结合同独立交易源、真实支付核对、签到授课与消费双复核、异议裁决、请假补课、逐课退款保留/独立审批/未知结果保留。HTTP controller 与 trade 源桥已编写。收费需 root 注入有效 merchant binding；免费报名不会生成假支付。已执行 API typecheck 通过、training-domain 单测 8/8。尚未执行真实 PG、端到端 UI；尚待 native 页面、真实 PG 测试及集成审查。Migration 046 仅已编写。

2026-11-01 检查点 2：新增原生课程页与机构/教练工作台（资格、课程/多课次排期、发布、报名、候补、付款人确认、课次签到/授课/独立消费复核/异议、退费审批、操作回执恢复）；已有真实服务端请求、缺资质/交易能力时禁用。新增培训用途/机构/班期/政策/epoch 精确授权读取模型，青少年招生继续关闭，不继承赛事授权。046 追加原始逐课金额与退款意图防篡改；资源占位改 partial active unique，每次新占位新行。已执行 API typecheck、领域 8/8、原生 VM 7/7；编写真实 PostgreSQL 集成测试 7 个场景（尚未执行，等待 root 合并 043–048 后隔离 CI）。本地无 PostgreSQL，不以类型检查替代数据库验证。尚待共享路由白名单/交易源/双向日历接线后综合验证，当前非 DONE。

2026-11-01 检查点 3：补全使用真实 TradeService、remainingSixTradeSources、trainingTradeHooks 的 PostgreSQL 收费链测试：同源冻结订单→真实持久 payment_attempt→合成渠道查询到账→过期实付 PAID_UNALLOCATED 不挤走新锁位→逐课退款+统一交易独立审核→派发网络结果未知→原单核对成功。只有 provider transport 为合成夹具，领域/交易/数据库使用正式实现。补 guardian purpose/cohort/policy/epoch 精确作用域测试与关闭 rollout 后历史付款/退款仍可读断言。另按集成人委派新增 scripts/r6-recovery-training.mjs，覆盖15张培训表、消费事实和UNKNOWN退款，连接真实 canonical trade order/refund；恢复隔离只允许暂停资格/招生、释放占位、撤销待报名/授权，不篡改金额、签到或消费。上述 PG/恢复脚本尚未执行；本地 typecheck、领域8/8、native7/7、脚本node --check通过。共享trade依赖只从root只读复制以便本地编译，未提交共享文件。

2026-11-01 审查修正：未实付且“已过期 + 供给被暂停”原先先返回REJECT，改为过期优先进入EXPIRED；实付仍PAID_UNALLOCATED，UNKNOWN仍先核对。显式取消收费锁位新增可信canReleaseUnpaidHold：只有零实付、无未决支付且零attempt/渠道已确认终态失败可取消，NOTPAY/UNKNOWN不假定未付。补正式trade PG回归。046增加同源trade_order/refund FK与不可换绑检查、占位enrollment复合机构FK；排期互斥与重复/失效资料改为明确业务冲突而非500。类型检查、领域8/8、native7/7、恢复脚本语法通过；真实PG仍待CI。

2026-11-01 共享日历专项（root追加委派）：新增 r6-shared-calendar.integration.test.ts，复用P04真实报名冻结/排赛发布与正式TrainingService/LocalServicesService，覆盖培训↔X12人员/场地、培训↔C06球员、培训↔正式court_reservations的双向先后及并发唯一占位；跨域新写释放过期培训学员锁/派单锁；正式parseDispatchQuote的97小时交通保护区间在实际服务时间之外仍阻止抢人。派单历史fixture显式SQL构造真实request/batch/offer/hold/资源外键关系，原过期期限仅INSERT不篡改。未改048。API typecheck通过；该7项PG专项待CI。原生页面补空态/未知退款实际模板render回归，现8/8。

2026-11-01 CI149反馈修正：原退款自审测试使用没有机构审批权限的学员，正确触发安全隐藏404，未触达独立复核规则。改为机构经办管理员提出退款；学员审批明确预期RESOURCE_NOT_FOUND/404，经办管理员审批明确预期INDEPENDENT_REVIEW_REQUIRED/403，另一位授权管理员审批成功，并核对持久proposed_by/reviewed_by不同。无放宽允许错误码、无修改生产授权逻辑。API typecheck通过；真实PG复跑交root隔离CI。

CI151日历专项夹具顺序修正：createCohort本身也是正式培训write，会运行x12_release_expired；原测试先造过期派单再创建草稿，在PUBLISH前已正确释放。现先准备培训草稿，再原子INSERT不可变过期派单历史，精确断言发布前active=true、首次后续培训write（PUBLISH）后active=false；保留hash/原offer状态及历史不可复活断言，不放宽预期。
