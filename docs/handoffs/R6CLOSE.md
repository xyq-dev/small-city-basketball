# R6CLOSE交接

2026-11-01（Asia/Shanghai）；`IMPLEMENTED / LOCAL_ONLY`。work/r6-insurance，基线dd6ebb6。仅本地提交，由root同步。

root唯一接线点：expansion-services导入remaining-six-privacy.ts的`readRemainingSixClosureOrgs`、`lockRemainingSixClosure`、`readRemainingSixClosureBlockers`、`revokeRemainingSixPrivacy`，给现有createAccountClosureHooks增加：

```ts
remainingSix: {
  orgScopes: readRemainingSixClosureOrgs,
  lock: lockRemainingSixClosure,
  inspect: readRemainingSixClosureBlockers,
  revoke: revokeRemainingSixPrivacy,
},
```

已有streaming/insurance/trade/notification/guardian依赖保持，特别不能去掉trade.assertAccountClosureSafe。缺任何remainingSix函数或四个新domain声明时注销被禁用；缺表/SQL错误不是“无阻断”。helper不依赖新模块service实例，数据库真实义务始终检查，模块feature关闭不能绕过注销保护。

顺序：AccountClosureService持用户FOR UPDATE；先读完整机构集合，原hook合并排序后NOWAIT取org/mutex/calendar，再取R6行与contact try-lock。inspect返回8类公开阻断码；全部域安全后revoke在同事务完成单调撤权。无任何历史删除、伪造支付/退款/完成结果。已结束订单仍保留；过往被拒派单者不承担后来他人已获选hold。

测试：domain/helper20/20、小程序注销7/7、API typecheck、diff check通过。新增`apps/api/test/r6-account-closure.integration.test.ts`六个真实PG用例，旧`account-closure.integration.test.ts`与`account-closure-domains.integration.test.ts`已接真实R6函数。PG本地未运行，root需完整044–048迁移后执行全部三文件；training guardian fixture使用新cohort_id/policy_version字段。

原保险真实vendor外部阻塞不影响此安全检查。广告ACCEPTED订单若业务仍未提供CLOSED流程会保守阻断，不能通过修改账号状态绕过资金/履约；实际完成流程由广告模块处理。

退款终态补充：training_refund_allocations的旧FAILED/REJECTED不单独永久阻断；其恢复的MAKEUP_DUE权益与canonical trade/新退款结果仍决定是否可关闭。PG覆盖保留旧FAILED历史后，新的成功退款结清权益。

广告回退补充：只有原return FAILED且其recovery case明确RECOVERED/WRITTEN_OFF、双人不同且证据有效，旧FAILED不再单独阻断；UNKNOWN/PROCESSING始终阻断。原provider状态不改写，root的canonical trade/module funds精算继续提供第二层（平台垫付不能因人工核销直接放行）。
