# R6TRAIN交接

2026-11-01 Asia/Shanghai，IN_PROGRESS / LOCAL_ONLY。起点为真实main c61ab36。允许/禁止范围见任务卡。
当前新增046培训模型、领域校验和交易hook，正在实现持久service/controller与原生页面。未运行PG、未生产执行Migration。
根集成需：TrainingService(pool, options, {enabled, trade})；注册TrainingController；导出training契约；增加TRAINING_ENROLLMENT统一交易源；048迁移为现有日历增加对training_resource_reservations的反向冲突检查。

检查点 1（本地）：API typecheck 已过；training-domain.test.ts 8/8。TrainingController + OrgTrainingController 注册 token SCB_TRAINING_SERVICE。导出 training-trade-source.ts 的 readTrainingTradeSource/trainingSourceReference/assertTrainingRefundAllocation/assertTrainingRefundDispatch/trainingClosureBlockers；termsId=null，consentId=冻结 terms_id；退款创建后服务保留 trade_refund_id，统一交易页再独立审核/发送。注入 TrainingTradeHooks.binding/capture/payment/refund/refundStatus，未注入不开放收费。048 须反向互斥并释放已过期 HOLDING enrollment 的 training_resource_reservations（enrollment_id 非空）。免费课程可完整服务闭环，付费代码仅读取真实桥，无支付模拟。仍需 UI/真实 PG 测试/整合证据。

检查点 2：新增 training-paths.js.trainingPathAllowed 供共享 expansion-api 调用；页面 pages/training/index 与 pages/training-manage/index；root需 app.json/menu/ui注册。TrainingTradeHooks.payment.orderId 为 string|null。046 的 active reservation partial unique 替代全表unique，reserveLearner只INSERT，历史 inactive不复活；root048负责identity不可变。training_guardian_grants增加cohort_id与policy_version（复合FK），readTrainingGuardianAuthorization要求purpose/policy/epoch独立有效；仍不提供青少年报名。root隐私接线需保留退款/消费/教练义务。
真实 PG 测试 apps/api/test/r6-training.integration.test.ts 使用现有注册、migrate与testDatabaseUrl，限定 scb_test_*，真实事务并发最后名额/FIFO、免费独立交易源、收费无bridge拒绝、自审拒绝/幂等、请假补课/免费退款独立复核、签到≠授课≠消费与异议、恢复隔离。未在本地执行。API typecheck 通过，node --test apps/wechat/test/r6-training.test.cjs 7/7。第二片修正派发 SQL 列名为trade_orders.kind；动态payable校验机构/场地/教练，而历史identity不变。

第三片：r6-training.integration.test.ts扩展至9个真实PG场景，收费测试直接调用正式TradeService+remainingSixTradeSources({trainingEnabled:true})与trainingTradeHooks；channel query/refund为合成transport，不是fake bridge。根须保留同名共享桥。scripts/r6-recovery-training.mjs导出 captureR6Training(context)→{proof,courtIds:[courtId]}，需要完整expansion context（registerSynthetic/state.commerce.operators/readPool/runtimePool）；verifyR6Training({readPool,saved,quarantined})只读比较全部15表逐行hash、immutable字段hash及canonical支付/退款/课次链。隔离可变列与map负责的quarantine约定已同步；所有事实表与金额不允许改变。当前PG/恢复仍是待CI执行。

第四片审查：TrainingTradeHooks.payment新增canReleaseUnpaidHold:boolean，root sourcePayment已提供；仅显式CANCEL安全使用，不改逾期实付原单处理。expired优先于供给无资格，避免无实付过期报名因暂停无法结束；PG覆盖无attempt取消、NOTPAY不得取消、供给暂停后过期释放。046增加canonical trade FK/同org/source/payer/amount校验（禁止换绑）及resource enrollment composite FK；root048日历identity guard兼容。所有共享trade本地复制仍未提交。

共享日历测试交接：apps/api/test/r6-shared-calendar.integration.test.ts（7个测试、内部包含先后双向/并发矩阵），PG待执行。P04保留真实publish流程，不直接绕过court_reservations源校验；C06旧预约/过期dispatch只显式合成history SQL，仍受所有真实触发器、唯一索引与FK约束。x12_release_expired只需释放local资源，不断言dispatch_holds/offer自动终态。声明圈定source拥有者数量恰好1并排除40P01；所有具时间保护的冲突断言覆盖实际服务窗口外。root复制的dispatch-domain/contract仅本地编译依赖，未提交共享文件。

CI149最小修复：r6-training.integration.test.ts退款职责夹具改为owner（具有ORG_OWNER权限）提出、owner自审403且精确INDEPENDENT_REVIEW_REQUIRED、learner无权审批404且精确RESOURCE_NOT_FOUND、reviewer作为ORG_ADMIN成功批准并校验原始申请/复核人。仅修正测试职责设置，不改service错误码和安全隐藏行为。API typecheck已过，PG待root复跑。

CI151反馈：共享日历6/7通过，唯一失败是过期派单已被prepareTraining正确提前释放。最小修复将过期历史放到创建培训草稿之后，PUBLISH前仍严格active=true/PUBLISH后false，并继续验证quote/status历史不变。无048生产修改；PG复跑交root。

补课选择器交接：现有TrainingController新增 GET `/v1/training/entitlements/:id/makeup-options`，无需新增controller或共享app接线；contracts/training新增TrainingMakeupOptionsData，training-paths精确放行GET。仅确认报名的学员本人、MAKEUP_DUE权益可读；付款人/机构管理员404隐藏。候选包含同机构同课程未来有效课次、当前公开排课资料/余位，无其他学员资料；服务端读与持锁MAKEUP共享资格/容量/本人跨源档期谓词，仍由048维护最终排时互斥。native从真实报名详情决定学员入口，选择服务端返回课次与权益版本，去掉手工UUID输入；超时恢复仍使用原命令，切号/隐藏丢弃候选响应。

新增PG第10项使用真实Nest controller、已有登录会话、真实TrainingService/迁移库，非模拟DTO；普通学员本人不是owner/reviewer/coach，独立payer/owner读候选明确404，payer写MAKEUP明确403，最后席位被占后旧候选明确MAKEUP_FULL，刷新后新目标成功且原权益金额/原课次不变。local native10/10及typecheck通过，PG待集成人实际CI。此前CI151原培训9项已通过、calendar修正0c4f248另片交付。本片无生产、资金渠道或Migration执行，独立只读审查与最终提交状态另报root。

集成前runtime补丁：training-service的operator/access两处平台权限查询改JOIN users + FOR SHARE OF u，保留platform_operators只读ACL，遵循维护者锁users的现有协议。独立审查未发现新阻断问题，并复跑native10/10；领域8/8与API typecheck通过。root反馈CI152原有新域已全部通过，本片新增候选PG与正式runtime待下一轮CI。此片之后仅处理确定失败或阻断，不继续扩展范围。

CI153确定失败修复：root反馈补课PG通过；scripts/r6-recovery-training.mjs原手改冻结时间违反runtime列级ACL。改真实DB clock短课（+60秒开始/+61秒结束，deadline+58秒），全部报名/支付/签到/授课仍走正式service；消费前轮询真正结束，单次等待250ms、总轮询最多75秒。若CI过慢未在开始前确认，显式失败而不放宽生产规则；授课后断言原冻结起止未变化与delivered_at≥ends_at。第二课仍在次日，100分UNKNOWN退款与15表恢复hash不变。直接SQL现在只有membership/court/历史REVOKED guardian INSERT及只读查询，未新增ACL/迁移或高权执行。待独立审查剩余权限与root下一轮完整runtime恢复实跑。

该恢复片独立审查已完成：发现并避开真实付款剩余30秒下限，现60秒短课留足付款窗口；15表其余写入及触发器/只增历史读取均静态匹配root实际runtime ACL，无第二个确定blocker。node --check/Prettier/diff通过，PG恢复未在本地执行。接续只需集成脚本和文档，复跑完整受限runtime恢复；不能把语法或静态权限核查当完成恢复。

PR35线程PRRT_kwDOVTBG086yW7tk/tl最小修正：index.js send采用会话持有token，当前writeToken在finally释放busy与可见性分离；旧会话不回填且不清新write锁。native12/12含实际onHide/onShow与切号并发。cohort CANCEL的恢复谓词由原enrollment.cohort_id改当前session.cohort_id，只恢复被取消实际课次的AVAILABLE权益；新增PG第11项跨班补课取消后再次补课，原报名/合同/金额/订单冻结不变。类型/格式/diff通过，PG由root下一轮实跑；root处理评论resolve与远端同步，无新增共享文件/迁移/ACL。

独立审查上述两修复未发现确定问题，独立native12/12。定向检查另确认training-manage页同一hidden-finally错误，同片采用相同令牌/释放策略并补真实生命周期成功/未知回归，最终本地native13/13；未知结果继续原命令核对。该机构端同因修复已向root报告，无可选功能扩展。最终PG11项与真实runtime恢复仍待下一轮CI。

2026-11-01 PR35结课P2（PRRT_kwDOVTBG086yXXZB）开工：独立 worktree `/workspace/scratch/aad368826b09/scb-six-training-completion`、分支 `work/r6-training-completion`，基线 `f66306c0bfa144b8c63a23c7403e59454b19da2d`，初始clean，远端仍为xyq-dev/small-city-basketball。允许路径为training领域/API/DTO/管理页及有效测试、本任务/交接；root负责整合，禁止生产与外部真实资金。拟新增有权限、版本及幂等回执的正常COMPLETE，核验本班及跨班权益、已结束授课及缓冲、未决退款/消费/资金未知。确定已收未结收入保留统一trade注销资金门；迟来异议重开关联已结班及报名，避免结课掩盖新义务。不加迁移或新状态。最终文档草稿已由root转交insurance，本worktree不写该草稿。

2026-11-01 PR35正常结课P2实施检查点（本地，待隔离PG）：新增 `POST /v1/training/cohorts/:id/commands` 的 `COMPLETE`，沿用机构管理员/fresh session、组织+共享日历锁、expectedVersion及commandId回执。必须填写结课依据，本班课次实际授课/取消且结束含buffer；同时检查原班外出补课和转入本班权益、消费最终确认、逐课退款及canonical账款。管理DTO新增 `canComplete/completionBlocker`，原生管理页有正常结课入口和阻断原因，终态不再展示暂停/取消。确定已收待结算收入不伪造结清，仍由统一trade注销资金门阻断；SOURCE_CONFLICT仅在原报名CANCELLED、全权益REFUNDED、全额真实退款及binding精确一致、无未决和净结算0时作为保留历史允许结课，其余冲突拒绝。

全部guard通过后，截止已过且严格无服务/实付/未知/退款/分账事实的候补、过期锁位及过期未确认报名可同事务转CANCELLED，保留AVAILABLE报价快照并记录审计；未知、实付或PAID_UNALLOCATED不自动处理。只释放本班session的占位，不动外班未来资源。已结课后消费DISPUTE或裁决返还权益会把相关已COMPLETED原班/当前补课班重开SUSPENDED，报名重开CONFIRMED，保留学员异议并恢复creator注销阻断。无新状态/迁移、无shared trade权限或生产变更。

新增5组真实PG服务场景：正常履约/权限/同命令并发与creator blocker；结课和新异议并发；双向跨班补课及迟来争议双班重开；转入课完成不误挡原班未来课/占位；未决免费退款及无人返回候补/过期锁位；真实TradeService收费确认后可结课但资金未结仍阻断注销、未知付款/终态异常marker/正常来源冲突阻断、真实退款UNKNOWN→SUCCESS全退例外，另以rollback-only INSERT负例核缺binding/部分退/UNKNOWN，不绕冻结事实。课次使用DB时钟创建4–6秒短课，收费样本45秒保持正式付款有效期门槛，100ms有界轮询等待，未修改冻结时间。PG未在本机执行，须root隔离CI验收。

本地验证：完整 `npm run typecheck`（含集成测试类型）通过；training-domain 8/8与原生training 16/16通过，修改源码/测试Prettier及git diff --check通过。独立dispatch只读审查发现并已修正source_hash列名、候补需安全关闭及测试capacity错误；前两次类型检查暴露provider测试接口/nullable回执和capacity字段遗漏，均已修复后通过。新增completion helper仅只读预览，写命令同锁重核；未用本地类型通过代替真实PG。

2026-11-01 结课片最终本地证据：API全量源码单测116文件/1339项通过；最终API typecheck（含本文件PG类型）、全项目typecheck、原生training16项、领域8项及修改文件格式/空白检查通过。培训真实PG从11个it增至16个it，新增收费场景内部含缺binding/部分退款/UNKNOWN的3组rollback-only持久异常，不计作独立已运行测试。最后细化已取消转入报名的全退例外须核其完整原来源权益与分配；普通外班未来课仍不阻断本班。真实PG/运行角色/页面兼容及恢复由root最终候选CI执行，此处没有通过声明。

2026-11-01 结课全退例外 follow-up（本地、待新候选PG）：独立审查发现转入本班的 CANCELLED/SOURCE_CONFLICT 原来源虽全额退款，其 UNKNOWN 分账/回退仍可能因非 primary 被漏检。现仅该完整来源例外和本班原报名采用全来源资金门，逐项拒绝未决退款、扣减、分账与回退；普通转入补课继续只核相关课次，不扩大到外班未来义务。原3组缺binding/部分退/UNKNOWN矩阵均改为真实外班源/本班当前课次，并新增2组完整全退先可结课、随后注入 UNKNOWN 分账/回退必须阻断的 rollback-only PG夹具；冻结原合同/课次不改，用新INSERT构造明确合成异常。培训仍16个it，矩阵5种，不计作已运行的独立测试。

本片API typecheck、training-domain 8/8、格式及空白检查通过；首次从仓库根误用API vitest相对过滤未发现文件，改在apps/api正确执行后8/8通过。本机无PG，新增矩阵尚未执行。GitHub CI158的新增域PG步骤已SUCCESS，但该候选不包含本follow-up，不能用其结果证明本漏项已修；原始job日志未可取，尚无逐文件通过声明。无迁移、shared trade、远端写或生产操作。

本follow-up独立只读复核已完成：确认clone原班/原课次与当前目标班不同，UUID快照/canonical身份/退款binding一致，先positive后UNKNOWN能准确命中全来源资金门；038列约束与未决回退唯一索引匹配，无剩余确定阻断。仍须新候选真实PG执行。
