# R6TRAIN 成人培训招生实现

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

状态：REVIEW；integration：BRANCH_ONLY。2026-11-01 Asia/Shanghai。
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

2026-11-01 补课可用性修正：移除学员手填课次UUID，新增已授权学员本人读取 `GET /v1/training/entitlements/:id/makeup-options`。冻结响应为 entitlementId、entitlementVersion、最多50个按开始时间排序的 items（sessionId/cohortId/cohortTitle/address/startsAt/endsAt/availableSeats/公开教练姓名）与 truncated。只返回同机构同课程、有效未来班期/课次，核对机构/教练/场地资格、实时名额及本人培训/X12/球员档期；付款人和机构管理员不因此取得学员选课权限。原有 MAKEUP 写入口持统一日历锁复用候选谓词，再占位；原课净价、合同、退款账本不变。小程序展示班级/日期/教练/地址/余位选择器、空态与刷新，使用服务端权益版本提交，切号/隐藏后丢弃迟到响应。

本片验证：原生VM与实际模板render 10/10、API typecheck通过；新增第10项真实Nest Controller+PostgreSQL集成场景，覆盖普通学员请假→读取→选课，付款人/管理员/匿名越权、不同课程/暂停/已满候选过滤、列表读取后最后席位被占及重新选课，验证原金额/原课次不变。该新增PG场景待root隔离CI；root反馈旧9项PG已在CI151通过，不把旧结果计作本片验收。无Migration变更。

runtime审查修正：operator/access两处原直接FOR SHARE平台权限表要求其UPDATE权限，与正式只读ACL冲突；按既有TradeService模式JOIN users并仅FOR SHARE OF u，仍核对操作员及用户ACTIVE，不扩平台表权限。只读独立审查未发现本片阻断问题，复跑native10/10，领域8/8与API typecheck通过。候选跨源档期SQL已对照048检查；真实PG新候选场景及runtime路径等待完整隔离CI，不宣称本地实测。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
2026-11-01 CI153恢复夹具修正：集成人反馈新增补课真实PG已通过，production恢复脚本在runtime账号下修改冻结课次时间被ACL正确拒绝。本片删除该UPDATE，不扩ACL、不使用owner/migrator绕过；在创建班期前读取真实DB clock，首课设为60秒后开始、61秒后结束、58秒后报名截止，第二课保持次日未来。正式支付确认后断言首课尚未开始，正式签到后每250ms只读核对DB课次结束（最多75秒）才DELIVER；核对冻结起止时间不变、授课时间不早于实际结束，之后原独立消费/100分UNKNOWN退款链不变。短课及渠道明确标记隔离合成，未把本地语法检查当runtime验收。

恢复修正独立审查：确认真实TradeService要求至少30秒付款剩余时间，已保留并加显式预检查；读DB时钟放在资格/教练/课程全部准备完成之后。其余15表service UPDATE列、追加历史表SELECT/INSERT、共享trigger及直接membership/court/REVOKED guardian INSERT均静态匹配真实runtime manifest，无第二个确定权限blocker。node --check、格式及diff检查通过，真实受限账号完整恢复待root隔离CI。

2026-11-01 PR35两个P2修正：培训页写命令用ui.hold/held和独立writeToken保护结果；finally释放当前命令busy不再依赖页面可见性，切号/卸载旧响应不回填私有数据、不释放新账号请求锁。新增真实Page lifecycle VM，覆盖hide→成功/未知结果→show能重新加载，以及旧账号写完成不干扰新账号在途命令，native现12/12。班期CANCEL改按权益current_session所属班期恢复AVAILABLE→MAKEUP_DUE，修复A报名到B补课后取消B遗漏；新增第11项真实PG场景A→B→取消B→恢复权益→C，核对资源释放、原A合同/净价/源订单不变及没有虚构消费退款。API typecheck与格式检查通过；新增PG待CI，未放宽退款、消费或机构权限。

P2定向检查确认机构工作台send具有完全相同hidden-finally锁遗留，已同片修复并补实际hide→write完成→show的成功/未知结果回归，native13/13；未知写仍保留原command待核对。独立审查确认跨班取消与学员页token改动无确定问题并复跑12/12，后续机构端同因修复另经本地13/13及格式检查。无修改共享权限、源订单或消费状态规则。

2026-11-01 PR35结课P2（PRRT_kwDOVTBG086yXXZB）开工：独立 worktree `/workspace/scratch/aad368826b09/scb-six-training-completion`、分支 `work/r6-training-completion`，基线 `f66306c0bfa144b8c63a23c7403e59454b19da2d`，初始clean，远端仍为xyq-dev/small-city-basketball。允许路径为training领域/API/DTO/管理页及有效测试、本任务/交接；root负责整合，禁止生产与外部真实资金。拟新增有权限、版本及幂等回执的正常COMPLETE，核验本班及跨班权益、已结束授课及缓冲、未决退款/消费/资金未知。确定已收未结收入保留统一trade注销资金门；迟来异议重开关联已结班及报名，避免结课掩盖新义务。不加迁移或新状态。最终文档草稿已由root转交insurance，本worktree不写该草稿。

2026-11-01 PR35正常结课P2实施检查点（本地，待隔离PG）：新增 `POST /v1/training/cohorts/:id/commands` 的 `COMPLETE`，沿用机构管理员/fresh session、组织+共享日历锁、expectedVersion及commandId回执。必须填写结课依据，本班课次实际授课/取消且结束含buffer；同时检查原班外出补课和转入本班权益、消费最终确认、逐课退款及canonical账款。管理DTO新增 `canComplete/completionBlocker`，原生管理页有正常结课入口和阻断原因，终态不再展示暂停/取消。确定已收待结算收入不伪造结清，仍由统一trade注销资金门阻断；SOURCE_CONFLICT仅在原报名CANCELLED、全权益REFUNDED、全额真实退款及binding精确一致、无未决和净结算0时作为保留历史允许结课，其余冲突拒绝。

全部guard通过后，截止已过且严格无服务/实付/未知/退款/分账事实的候补、过期锁位及过期未确认报名可同事务转CANCELLED，保留AVAILABLE报价快照并记录审计；未知、实付或PAID_UNALLOCATED不自动处理。只释放本班session的占位，不动外班未来资源。已结课后消费DISPUTE或裁决返还权益会把相关已COMPLETED原班/当前补课班重开SUSPENDED，报名重开CONFIRMED，保留学员异议并恢复creator注销阻断。无新状态/迁移、无shared trade权限或生产变更。

新增5组真实PG服务场景：正常履约/权限/同命令并发与creator blocker；结课和新异议并发；双向跨班补课及迟来争议双班重开；转入课完成不误挡原班未来课/占位；未决免费退款及无人返回候补/过期锁位；真实TradeService收费确认后可结课但资金未结仍阻断注销、未知付款/终态异常marker/正常来源冲突阻断、真实退款UNKNOWN→SUCCESS全退例外，另以rollback-only INSERT负例核缺binding/部分退/UNKNOWN，不绕冻结事实。课次使用DB时钟创建4–6秒短课，收费样本45秒保持正式付款有效期门槛，100ms有界轮询等待，未修改冻结时间。PG未在本机执行，须root隔离CI验收。

本地验证：完整 `npm run typecheck`（含集成测试类型）通过；training-domain 8/8与原生training 16/16通过，修改源码/测试Prettier及git diff --check通过。独立dispatch只读审查发现并已修正source_hash列名、候补需安全关闭及测试capacity错误；前两次类型检查暴露provider测试接口/nullable回执和capacity字段遗漏，均已修复后通过。新增completion helper仅只读预览，写命令同锁重核；未用本地类型通过代替真实PG。

2026-11-01 结课片最终本地证据：API全量源码单测116文件/1339项通过；最终API typecheck（含本文件PG类型）、全项目typecheck、原生training16项、领域8项及修改文件格式/空白检查通过。培训真实PG从11个it增至16个it，新增收费场景内部含缺binding/部分退款/UNKNOWN的3组rollback-only持久异常，不计作独立已运行测试。最后细化已取消转入报名的全退例外须核其完整原来源权益与分配；普通外班未来课仍不阻断本班。真实PG/运行角色/页面兼容及恢复由root最终候选CI执行，此处没有通过声明。

2026-11-01 结课全退例外 follow-up（本地、待新候选PG）：独立审查发现转入本班的 CANCELLED/SOURCE_CONFLICT 原来源虽全额退款，其 UNKNOWN 分账/回退仍可能因非 primary 被漏检。现仅该完整来源例外和本班原报名采用全来源资金门，逐项拒绝未决退款、扣减、分账与回退；普通转入补课继续只核相关课次，不扩大到外班未来义务。原3组缺binding/部分退/UNKNOWN矩阵均改为真实外班源/本班当前课次，并新增2组完整全退先可结课、随后注入 UNKNOWN 分账/回退必须阻断的 rollback-only PG夹具；冻结原合同/课次不改，用新INSERT构造明确合成异常。培训仍16个it，矩阵5种，不计作已运行的独立测试。

本片API typecheck、training-domain 8/8、格式及空白检查通过；首次从仓库根误用API vitest相对过滤未发现文件，改在apps/api正确执行后8/8通过。本机无PG，新增矩阵尚未执行。GitHub CI158的新增域PG步骤已SUCCESS，但该候选不包含本follow-up，不能用其结果证明本漏项已修；原始job日志未可取，尚无逐文件通过声明。无迁移、shared trade、远端写或生产操作。

本follow-up独立只读复核已完成：确认clone原班/原课次与当前目标班不同，UUID快照/canonical身份/退款binding一致，先positive后UNKNOWN能准确命中全来源资金门；038列约束与未决回退唯一索引匹配，无剩余确定阻断。仍须新候选真实PG执行。

2026-11-01 PR35暂停恢复P2（PRRT_kwDOVTBG086yXjjH）续作：独立worktree仍为scb-six-training-completion、分支work/r6-training-completion，基线eb77023且开工clean；仅training服务/DTO/原生页/有效测试及本任务交接。新增受控RESUME（同原cohort命令入口）：只准SUSPENDED，沿用manager/fresh、组织+共享日历锁、expectedVersion和commandId回执。培训总开关/恢复隔离仍有效；重新核当前机构/场地及剩余课次教练资格、双向关联权益的PROPOSED/REVIEWED/DISPUTED消费。管理员不能借恢复跳过独立异议裁决。

RESUME不创建报名、资源、订单或资金事实。未来/进行中课次及尚未结束的缓冲窗口必须保有精确原court/coach ACTIVE占位；已结束SCHEDULED课次可用精确原占位历史补交真实授课，不复活已释放行。截止前恢复ENROLLING，截止后RUNNING且新报名仍拒绝。另堵住DRAFT直接SUSPEND绕首次PUBLISH的入口，暂停仅ENROLLING/RUNNING；SUSPENDED仍可按现条件CANCEL/COMPLETE。管理DTO增加canResume/resumeBlocker，原生提供恢复班期及依据，原暂停文案更正为暂停班期。

新增3个真实PG it（培训16→19）：暂停恢复同命令并发/权限/版本，保留名额资源资金且继续真实授课消费；截止后恢复RUNNING、不重新招生、释放的结束占位仅核历史，PROPOSED/REVIEWED及结课后迟来DISPUTE都拒恢复、平台独立裁决后方可恢复；关闭总开关、机构资质到期、教练停审、场地停用、丢失原发布占位及草稿暂停全部拒绝。短课仍等待真实DB时钟，冻结时间无改写；失效资格和已释放占位用明确合成数据库夹具，不绕版本规则。新增原生真实Page VM3项，总19/19通过；领域8/8、完整npm run typecheck与格式/diff检查通过。真实PG本机无环境，必须后续CI实跑；CI159不含本恢复功能，不能用其绿灯替代本次验证。无迁移、ACL、shared trade、远端写或生产变更。

独立dispatch终审未发现本片确定P1/P2，并独立复跑API typecheck、原生19/19及diff检查通过；核对了多轮暂停/恢复/结课/异议版本链、独立裁决actor、真实incoming范围和原资源历史约束。附带只读检查现有非终态后继：草稿发布/取消；招生及授课暂停/结课/取消；暂停恢复/结课/取消；报名锁位确认/核对/取消、候补领位/取消、逾期与付款未分配走核对或逐课退款；权益经消费复核/请假补课/退款，未决消费经本人确认或独立裁决，未知退款由原统一交易查询后刷新。未发现另一个已确认的同类无后继状态，本轮不增其它业务操作；青少年未开放及外部付款结果未核实保持既定能力边界。
