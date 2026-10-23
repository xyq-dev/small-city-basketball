# C05 商业计费交接

2026-10-24（Asia/Shanghai）；负责人c04_result_design，root唯一集成人。独立worktree `/workspace/scratch/dc6a786e1a31/c05-commerce`，分支`feat/C05-COMMERCE`，基线`ead3a62dd2dc996d11798d356c4ab96ed2b5c845`；origin为原xyq-dev仓库。REVIEW / BRANCH_ONLY，尚未推送或合并，最终提交以Git读取为准。

已实现十表`013_c05_commerce.sql`、独占契约、service/controllers、首次赛程原事务激活helper、离线operator CLI、机构/独立平台页面和严格API客户端。仅CNY整数分按届软件服务，不混报名费/押金/钱包；不可变套餐版本/报价，双平台操作员独立复核线下收款/未激活全额退款，机构负责人不能自授平台权限。首次正式发布原子激活；旧正式赛事LEGACY、OFF兼容，已激活后到期不阻断比赛/读取/后续晋级。激活后退款争议只审计，不暗扣权益。

`platform_operators`仅runtime SELECT；原lockActor的用户SHARE与离线维护用户UPDATE串行，撤销后旧会话失去平台权。平台订单命令从开始锁机构UPDATE，与原成员维护SHARE互斥，防新增机构成员绕过独立审核。CLI仅维护数据库身份、所有者0400/0600普通小文件、禁止符号链接/内联环境或命令行权限参数，不运行正式数据。

Native APIv3由独立作者提交`1ad5ae4`及最终`311b13c927407363e9fc4d287f29b78ec726e211`，root须同时整合provider/test/其交接三文件；本树复制联编，主体提交不重复包含该三文件。50协议测试使用合成RSA/AES密钥与受控transport；没有真实商户凭据、没有外部资金调用。页面本地qrcode生成真实Native code_url二维码，仅服务端验签通知或查单可改变账本。

回调持久化幂等、原交易/币种/金额/退款身份校验；支付减免不替代订单原总额。退款固定原号，不在网络未知时新建退款；完整审计原因保留，但向微信只发80 UTF8字节内固定原因。SUCCESS回调早于同步答复时不降级，晚到相同身份的真实create_time只补一次accepted_at；任何不同provider_refund_id先拒绝。没有真实受理时间时不拿本地发送/完成时间推造。对账按Asia/Shanghai日期双向比较，人工精确付款及退款流水，Native退款按受理日/申请全额/原退款号核验；历史账单状态仅快照，不代替当前查单结论。空账单检测LOCAL_ONLY，错误账单日不得通过。人工CSV最多64KiB，输入交易引用限制为单行、无逗号/控制字符。

root共享`service.ts/runtime-config.ts/commerce-runtime.ts/request-body.ts/errors.ts`仅复制联编，不回拷不暂存；node_modules符号链接不提交。root拥有app/manifest/运行配置/index/App/package/lock，gate须插入原schedule事务、调用前已持有event UPDATE，不开嵌套事务。manifest退款UPDATE列需含accepted_at；原始Buffer仅POST `/v1/payments/wechat/notifications`例外Origin且≤100KiB。Session platformOperator提示不替代每请求鉴权。

本机已完成API/admin strict与build；API源码完整测试执行结果在提交后报告，商业新增domain/activation此前9项通过，补引用边界后增1项；admin新增9项单测通过（真实组件+受控响应，不是浏览器/支付证据）。已有Vite约500KiB chunk提示不影响构建。编写两份真实PG集成文件：人工双审/隔离/CAS并发/首次ENFORCED门禁/全额退款/不可变SQL/最小runtime权限/撤销；Native真实HTTP和PG配合合成签名通知及受控transport，覆盖金额错误、幂等、早到回调、晚到不同退款ID、长审核原因、双向退款账单及错日。**本机无PG/Docker，以上PG文件与013均未执行；必须由root隔离CI实跑，不将strict、协议fixture或作者报告写成数据库/真实付款验收。**桌面/手机真实浏览器、production HTTPS、重启/备份第二实例恢复由root整合后统一执行和记录。

下一位先整合本主体提交与provider311b13c，保留root共享版本，执行全部strict/build/format/source，再隔离PG/HTTPS/真实桌面手机模拟/全表恢复及独立审查。无生产部署、正式Migration/账号维护、付费资源、新外部凭据或公网端口。本轮真实微信商户付款/退款/实际日账单、真实小程序工具/真机、原生OBS均未验证，不能宣称完整商业生产验收通过。

## 隔离CI审计主体修复

2026-10-24（Asia/Shanghai），root真实隔离production CI39997736172在平台权限维护阶段失败。核实旧001的audit_logs.actor_id为NOT NULL且外键users；新CLI及账本systemAudit传NULL会23502，原作者本机没有PG，strict无法覆盖该错误。已统一新建commerce/system-actor.ts：调用方原事务内先插入随机唯一email/UUID、DISABLED状态、113字符不可verifyPassword的sentinel系统用户，再用真实ID写审计；不冒充普通owner、不授机构/平台权限、不放宽旧schema或runtime ACL，维护CLI保留受控错误。人工收款/退款及Native资金审计共同覆盖。2项新增unit与原domain/activation合计12项通过，API strict/build通过。真实PG新增JOIN审计主体禁用及无会话/角色、账本重放一次审计、约束失败后事务回滚无孤立actor断言；本机仍未执行PG，交root重新隔离CI，不能把最初source通过描述为资金闭环通过。root独立审查作者c05_review已读草稿无代码修改建议，最终提交后须重新核验并记录。
