# R6TRAIN交接

2026-11-01 Asia/Shanghai，IN_PROGRESS / LOCAL_ONLY。起点为真实main c61ab36。允许/禁止范围见任务卡。
当前新增046培训模型、领域校验和交易hook，正在实现持久service/controller与原生页面。未运行PG、未生产执行Migration。
根集成需：TrainingService(pool, options, {enabled, trade})；注册TrainingController；导出training契约；增加TRAINING_ENROLLMENT统一交易源；048迁移为现有日历增加对training_resource_reservations的反向冲突检查。

检查点 1（本地）：API typecheck 已过；training-domain.test.ts 8/8。TrainingController + OrgTrainingController 注册 token SCB_TRAINING_SERVICE。导出 training-trade-source.ts 的 readTrainingTradeSource/trainingSourceReference/assertTrainingRefundAllocation/assertTrainingRefundDispatch/trainingClosureBlockers；termsId=null，consentId=冻结 terms_id；退款创建后服务保留 trade_refund_id，统一交易页再独立审核/发送。注入 TrainingTradeHooks.binding/capture/payment/refund/refundStatus，未注入不开放收费。048 须反向互斥并释放已过期 HOLDING enrollment 的 training_resource_reservations（enrollment_id 非空）。免费课程可完整服务闭环，付费代码仅读取真实桥，无支付模拟。仍需 UI/真实 PG 测试/整合证据。

检查点 2：新增 training-paths.js.trainingPathAllowed 供共享 expansion-api 调用；页面 pages/training/index 与 pages/training-manage/index；root需 app.json/menu/ui注册。TrainingTradeHooks.payment.orderId 为 string|null。046 的 active reservation partial unique 替代全表unique，reserveLearner只INSERT，历史 inactive不复活；root048负责identity不可变。training_guardian_grants增加cohort_id与policy_version（复合FK），readTrainingGuardianAuthorization要求purpose/policy/epoch独立有效；仍不提供青少年报名。root隐私接线需保留退款/消费/教练义务。
真实 PG 测试 apps/api/test/r6-training.integration.test.ts 使用现有注册、migrate与testDatabaseUrl，限定 scb_test_*，真实事务并发最后名额/FIFO、免费独立交易源、收费无bridge拒绝、自审拒绝/幂等、请假补课/免费退款独立复核、签到≠授课≠消费与异议、恢复隔离。未在本地执行。API typecheck 通过，node --test apps/wechat/test/r6-training.test.cjs 7/7。第二片修正派发 SQL 列名为trade_orders.kind；动态payable校验机构/场地/教练，而历史identity不变。
