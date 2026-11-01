# R6CLOSE：六模块注销与隐私闭环

2026-11-01（Asia/Shanghai）。root追加委派；implement_insurance负责。工作目录 `/workspace/scratch/aad368826b09/scb-six-insurance`，分支work/r6-insurance；切片基线dd6ebb6。状态 `IMPLEMENTED / LOCAL_ONLY`。

依据各模块最新044–047实际schema（含training guardian cohort/policy范围、dispatch不可变报价/hold、sponsor十表）。新增remaining-six-privacy.ts；AccountClosureDependencies强制检查remainingSix四函数，缺失时关闭注销；ACCOUNT_CLOSURE_DOMAINS增加TRAINING、MATCHING、DISPATCH、SPONSOR_COMMERCE。类型允许旧composition暂不注入，但运行时绝不把缺域解释为无事项。

实施：先汇总用户实际涉及的培训/撮合/派单/广告机构，与原组织集合排序合并后获取组织/共享日历锁；新模块source行全部NOWAIT，撮合联系consent使用原4402 try-lock，竞争重试。检查学员/教练未完成服务、扣课争议/退款（PENDING/UNKNOWN未结；已确认为FAILED的旧分配保留，未消费课次仍阻断）；双方意向、原业务订单仍未结/缺源；跨城邀约/人员占位/原服务；广告合同与履约以及独立多方分账、渠道完结、分账回退、退款和追回。后者与既有TradeService.assertAccountClosureSafe双层执行，不用本地UNKNOWN假造完成。

仅安全结案时撤回matching发现/联系偏好、关闭自有需求和未转单意向、取消相关待通知；撤回dispatch偏好及自己过期未转单offer/hold，保留他人后续获选hold与所有已转原单；撤回教练同意、training监护授权并递增版本/epoch。候选、命令收据、合同、订单、资金、出勤及所有历史不删。

验证：注销domain+R6 helper定向20/20、小程序注销7/7、API typecheck、diff check通过。新增真实PG6例覆盖waitlist/剩余补课/UNKNOWN退款、教练待交付/监护撤回、consent竞争NOWAIT、双方意向与通知撤回、历史declined派单方不误释放他人hold、源已CLOSED但多方UNKNOWN回退仍阻断。旧closure两套真实PG接真实R6依赖。真实PG未在本地执行，需root/CI在完整迁移集执行。

待集成：root在expansion-services注入四函数（详交接），并执行上述PG+全部closure回归；未改其文件。没有生产操作。

复核补充：培训agent确认退款FAILED是已终结失败且课次退回MAKEUP_DUE，后续可创建新分配。删除旧FAILED永久资金阻断，仍由MAKEUP_DUE/剩余权益、新未决退款和canonical trade检查阻断；PG用例覆盖旧FAILED保留但新退款成功后可安全结案。

广告复核补充：ads agent确认RECOVERED/WRITTEN_OFF是双人独立核对证据的追偿终态，不改原渠道FAILED。helper仅在FAILED且绑定case有不同提议/复核人、有效证据和明确终态时不把旧失败永久计未决；UNKNOWN/PROCESSING不受此例外影响。canonical trade资金余额与平台垫付检查继续必须通过，不能凭人工case跳过资金核验。PG用例用048实际SPONSOR_ORDER kind并覆盖此区分。

CI150夹具修复：六例初始化均因password_hash长度约束失败，现统一在beforeAll使用正式hashPassword为仅回滚的合成用户生成随机密码哈希；不弱化生产约束。同时逐项核对根f7dcb03的044–048 schema，修复dispatch持有报价必须含与quote_hash一致的hash字段。API typecheck及diff check通过；真实PG仍待root/CI重跑，未将静态核对称为PG成功。

PARTIAL结案复核修复：仅放宽历史PARTIAL/FAILED的粗粒度字符串阻断，同时对sponsorScope内每个原单强制调用readSponsorClosureFunds精算；包括没有本人trade_order的受益机构管理员与批次审核人。缺原单、UNKNOWN、留存/失败项未完整分摊、缺费用凭据、精算失败均仍关闭。canonical原单/付款/退款提前NOWAIT锁，原历史不变。补4个PG参数例（两个非本人角色×全额/部分退款），每例先验证UNKNOWN与缺费用凭据阻断，再验证只有全退解锁；另补缺原单/精算错误单测。定向unit21/21、API typecheck与diff check通过；PG本地未运行，CI待验证。仅本地复制ads源依赖用于typecheck，不纳入本提交。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
PR35 P2（线程PRRT_kwDOVTBG086yW7tj）修复：预确认CANCELLED保留的AVAILABLE课次仅在没有签到/消费/退款分配、canonical绑定完全匹配且无实付或未决支付、无退款/扣减/结算事实时不计未完成服务；仍按kind/source查原单，不能用空trade_order_id隐藏账本。支付只有零attempt或明确FAILED/CLOSED可豁免，PAID/DISPATCHING/UNKNOWN/NOTPAY均阻断；MAKEUP_DUE等原权益不豁免。新增培训canonical订单及资金行NOWAIT锁。培训owner确认正常WAITLISTED/HOLDING取消仅留下AVAILABLE，确认后才能签到/消费；不修改其CANCEL语义或删除历史。

新增真实PG十组矩阵覆盖候补/锁位取消、无交易/零attempt/FAILED/CLOSED、PAID/DISPATCHING/UNKNOWN/NOTPAY和缺反向绑定，安全分支额外加入签到后须重新阻断。夹具复现真实CANCEL落库事实并直接执行真实closure hooks；TrainingService已有真实CANCEL集成测试，未冒称本文件执行HTTP端到端。定向unit21/21、API typecheck、diff check通过；PG本地未运行，交root/CI。生产/真实渠道未操作，root负责外部线程resolve。

2026-11-01 Asia/Shanghai 新审查跟进：root授权 implement_insurance 在独立 `scb-six-insurance-review` / `work/r6-closure-review`（实际基线87a8bcbe869b93844805143ef33b85c1a1b9e221、初始clean、远端xyq-dev/small-city-basketball）修改 remaining-six-privacy.ts 及其unit/PG测试。范围为广告明确未付关闭、零元外部分账终态及保留原退款/回退记录的显式恢复后注销；ads独占source资金精算与retry schema，root负责trade和ACL。当前IN_PROGRESS / LOCAL_ONLY，新增真实PG待隔离CI，禁止生产/真实渠道。原未决/UNKNOWN与缺canonical继续阻断，不以删除粗状态谓词替代逐单精算。

本片完成（源码待集成，PG待CI）：广告注销范围保留已CLAIMED/已SUCCEEDED流程的合同、履约、批次、原计划、恢复退款与追偿审核/提议人，纯审核者也锁原合同。新增delivery、canonical扣减/结算、sponsor_refund_retries及原计划/后继全部refund引用NOWAIT锁。零元项仅接纳NOT_REQUIRED且外部/non-retained/amount=0；未决计划、后继、回退、追回仍粗阻断，每个scope原单同时强制readSponsorClosureFunds完整精算。明确失败的原CLAIMED是否履行由ads冻结retry链精算，不能凭状态放行；canonical缺失仍阻断，明确未付关闭须ads helper核对来源身份和零服务/资金事实。

新增15组真实PG回归：10组未付关闭的付款状态/身份/缺canonical矩阵（含历史合同审核者和受益机构管理员）、2组零元NOT_REQUIRED及未解冻/原合同未关闭阻断、3组受益管理员/原计划审核者/纯后继审核者的APPROVED→CLAIMED UNKNOWN→SUCCEEDED与旧退款迟到SUCCESS再阻断。全部使用合成持久事实和真实closure hooks，不冒称service端到端；原refund/plan/binding/recipient-return保持不变且仅一份回退。旧PARTIAL四组夹具补真实immutable binding，适配严格精算。新增4项unit验证每个scope逐单核验、精算异常/非法金额和未决事实fail-closed。`vitest run src/remaining-six-privacy.test.ts src/account-closure-domain.test.ts`25/25、API typecheck、diff check通过；本地没有PG/Docker，15组PG及新retry schema/精算联动必须交root完整隔离CI执行。依赖ads的047、source及sponsor-commerce-refund-resolution；本提交不包含其文件、不改根trade/ACL、不直接推送或评论PR。

2026-11-01 Asia/Shanghai CI156夹具跟进：root报告新域PG130项中126通过、4失败，其中本文件3项失败。独立 `scb-six-insurance-ci156` / `work/r6-closure-fixtures`，实际基线9308f0de555a453b2bb7e364fbce52d5ee9ba880、初始clean。根因是旧unknown-recovery和PARTIAL参数样本仍以空source_snapshot/固定a哈希建立trade，paid closure已严格校验真实来源identity，故正确提前阻断；新15组使用真实identity的样本无此问题。本片仅在这两段通过readSponsorTradeSource取得真实source.identity并以tradeHash计算canonical哈希，trade与batch保存同一哈希；保留全部UNKNOWN、缺费用凭据、半额退款阻断和终态历史断言，不修改生产精算/隐私/资金代码或Migration。真实PG复跑仍交root隔离CI，禁止生产与外部渠道操作。

CI156夹具小片验证：unit定向25/25、API typecheck、单文件Prettier、git diff --check通过；PG未在本地执行，三处原断言和全部负例不变，待root下一次完整隔离CI复核。仅测试与本任务/交接文档修改，未放宽真实source校验。
