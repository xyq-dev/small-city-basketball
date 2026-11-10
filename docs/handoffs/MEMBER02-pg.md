# MEMBER02 PostgreSQL 集成测试接续

2026-11-10 Asia/Shanghai；membership_schema_review / MEMBER02-pg 独占作者；IN_PROGRESS / LOCAL_ONLY。

目录 `/workspace/scratch/dc6a786e1a31/scb-member02-pg`；分支 `feat/MEMBER02-pg`；从c8e0693创建并整合核心a08750f进行类型核验。只新增本卡测试文件与接续文档，不修改核心/契约/接线/manifest/迁移或汇总。不push；交root精确提交整合。所有旧worktree保留。

目标：真实隔离PG上以已有API/harness合法创建会员计划/订单、双人核验付款、购买期、首次publish和并发消费/退款/续期；旧按届报价、权限和付款复用保持。不假造跨届消耗、关闭触发器或改财务历史来制造到期。EXPIRED精确到期暂由核心纯函数覆盖，不冒称真实HTTP过期验收。

本机未配置PG，真实PG测试未执行；仅编写、静态类型与格式验证，隔离执行交root既有CI。未触生产、真实网关/资金或外部凭据。


## 2026-11-10 16:19 Asia/Shanghai 实施与静态核验

测试文件已完成16例，全部使用原真实隔离PG harness并以HTTP创建计划/订单/付款核验/退款/续期，不引入Mock transport或真实商户。按届EVENT quote不加scope，会员订单event_id必须NULL且没有占位赛事。覆盖固定四套餐、拒绝自定额度/小数钱/权限、跨机构与owner限定/不升权、重放/CAS/重复下单、双人核验和固定秒购买期、关闭支付、原publish后续故障全事务回滚再成功、activation helper事务回滚/重放/抢最后额度、原按届已购优先与不足/待核对不暗扣、unused退款冻结/独立退款撤销、退款vs首激活并发、已消费争议保持、30天连续下一期SCHEDULED且不能借额/父期有有效子单不能退、365天首期早续拒绝。

正式publish专例沿原报名/独立审核/冻结/场地/排稿/真实发布链，隔离故障trigger只匹配本例event且finally移除；其他额度边界调用原activateEventCommerce并显式使用组织SHARE→event UPDATE→原helper事务，不能把这些单独helper事务描述成全部真实排赛发布。未关原guard或更改配额/消费历史。

052撤销理由CHECK真实PG专例：先HTTP合法生成付款及退款待复核；rollback-only事务按原锁序暂存合法人工SUCCEEDED证明，SAVEPOINT下分别测试NULL/空/3字/501字revoke_reason，必须由实际pg_constraint名字的23514拒绝，随后同窗口合法reason能通过，再整体ROLLBACK。最后真实HTTP独立退款确认。该rollback-only证明不是实际付款网关验收，不留下虚构已退款历史；新CHECK仍待真实CI执行才能判通过。

实际已执行：完整API `tsc --noEmit -p apps/api/tsconfig.json`通过；新增测试Prettier和git diff --check通过。首轮类型失败是测试参数过宽EventData，已收窄至helper真正使用的id/version并重验，不放宽业务。真实PG未执行；没有运行返回skipped的Vitest作为证据。本机依赖只临时链接root已有node_modules，提交前unlink链接，未安装/变更依赖、未动目标目录。

整合基线已包含核心a08750f与DDL修复5aba1a/6096470。只提交本测试与本handoff；root仅cherry-pick最后测试提交（不要重复cherry-pick以上核心父提交）。root需要已接OrgSoftwareMembershipController/PlatformSoftwareMembershipController和完整052/manifest后运行原隔离CI。EXPIRED精确边界仍仅核心纯函数覆盖，本文件没有伪造真实HTTP过期链。
