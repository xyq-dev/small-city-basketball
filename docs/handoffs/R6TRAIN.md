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
