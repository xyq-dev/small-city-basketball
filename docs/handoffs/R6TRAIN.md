# R6TRAIN交接

2026-11-01 Asia/Shanghai，IN_PROGRESS / LOCAL_ONLY。起点为真实main c61ab36。允许/禁止范围见任务卡。
当前新增046培训模型、领域校验和交易hook，正在实现持久service/controller与原生页面。未运行PG、未生产执行Migration。
根集成需：TrainingService(pool, options, {enabled, trade})；注册TrainingController；导出training契约；增加TRAINING_ENROLLMENT统一交易源；048迁移为现有日历增加对training_resource_reservations的反向冲突检查。

检查点 1（本地）：API typecheck 已过；training-domain.test.ts 8/8。TrainingController + OrgTrainingController 注册 token SCB_TRAINING_SERVICE。导出 training-trade-source.ts 的 readTrainingTradeSource/trainingSourceReference/assertTrainingRefundAllocation/assertTrainingRefundDispatch/trainingClosureBlockers；termsId=null，consentId=冻结 terms_id；退款创建后服务保留 trade_refund_id，统一交易页再独立审核/发送。注入 TrainingTradeHooks.binding/capture/payment/refund/refundStatus，未注入不开放收费。048 须反向互斥并释放已过期 HOLDING enrollment 的 training_resource_reservations（enrollment_id 非空）。免费课程可完整服务闭环，付费代码仅读取真实桥，无支付模拟。仍需 UI/真实 PG 测试/整合证据。
