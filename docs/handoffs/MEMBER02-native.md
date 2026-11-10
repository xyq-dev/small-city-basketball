# MEMBER02 Native 支付/闭单真实PG与合成协议测试

2026-11-10 Asia/Shanghai；membership_schema_review；REVIEW / LOCAL_ONLY。

独占目录 `/workspace/scratch/dc6a786e1a31/scb-member02-native`、分支 `feat/MEMBER02-native`，基线9d13fca并整合核心abe7629。只新增本测试与本交接，不改服务/052/原PGfile/接线/汇总，不push。沿用隔离测试授权，不触生产/真实资金/外部新凭据。

用真实HTTP和原PG ledger，SDK采用进程内临时合成RSA/AES密钥及受控fetch transport，不向微信联网。验证秒精度付款、金额/身份/回调去重、UNKNOWN不解锁、signed204仅ack且CLOSED原单proof才CANCELLED、旧EVENT与新会员共享路径及DB终态/跨单proof隔离。实际PG本机未执行；静态类型/格式结果随后记录，不用skips冒充通过。


## 2026-11-10 16:37 Asia/Shanghai 编写与静态核验完成

新增8例协议与PG场景：

1. Native启动无任何权益；经合成RSA签名/AES加密的错误金额和商户身份不能授予，真实数据库创建时间含毫秒、provider success_time取创建同秒floor秒可合法开期；重复通知及后续查单只保留一个30天/3届购买期，不产生event_entitlements。
2. UNKNOWN查询、PAYERROR、REVOKED保持Native原单采购阻断；仅签名查到原单CLOSED后写一个对应proof并CANCELLED、保留渠道。相同command重放不再发网络、不同command重查不重复proof；关闭后矛盾SUCCESS回调409且整条通知回滚、无复活。
3. CLOSE_NATIVE先查到provider SUCCESS正常结算，绝不发送close。
4. 原NOTPAY必须先收到签名空体204，再签名查询原交易CLOSED才释放，校验原trade路径/商户body。
5. 204后仍NOTPAY、close网络未知都不释放；后续只查询原单CLOSED可恢复，不重发close。
6. 旧EVENT Native原单同样UNKNOWN/未核实闭单时阻断会员扣额；验证CLOSED后才让原activation事务消费真正已付会员期，旧EVENT quote无scope、原单仍CANCELLED/渠道保留。
7. DB直接Native取消缺自己的proof必须23514；rollback-only复制另一订单的真实proof hash但保留其source order，仍不能授权目标取消。目标原单真实签名闭单后，DB直接改PAID被终态guard拒绝。跨单伪构造只存在回滚事务，不留下假通知。
8. Native会员退款仍要求两个不同平台operator；signed PROCESSING不撤销，原退款查单SUCCESS才撤销未用原购买期，后续重复签名/AES退款回调不重复退款或购买期。

实际执行：完整API `tsc --noEmit -p apps/api/tsconfig.json`通过；新增文件Prettier和git diff --check通过。初次tsc的CLOSE_NATIVE/canCloseNative错误来自共享node_modules包指向root旧contract，已建立临时私有依赖链接树，将@small-city-basketball/contracts指向本worktree后完整通过；没有更改root node_modules或依赖锁。临时node_modules链接提交前unlink。

真实PG尚未执行；无skips成功声明。合成RSA/AES仅验证协议与应用路径，不是微信商户、真扣费或退款验收；没有向外网微信发请求。额度使用的EVENT场景调用原activateEventCommerce并保持组织SHARE→event UPDATE事务，不冒称本文件再跑完整发布链（完整publish含回滚由另一PG文件覆盖）。

整合请只cherry-pick本测试提交，两新增路径；9d13合同和abe7629实现父提交由root/core已有，无需重复。root接线+052+runtime manifest后交既有真实隔离PG CI执行；任何首次运行失败须保留真实记录并修复，不能按本文编写完成标为通过。
