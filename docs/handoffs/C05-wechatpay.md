# C05 微信支付 APIv3 Native 协议交接

2026-10-24（Asia/Shanghai）；负责人c04_result_design/wechatpay_adapter。基线ead3a62，独立目录/workspace/scratch/dc6a786e1a31/c05-wechatpay-adapter，分支feat/C05-wechatpay-adapter；origin原small-city-basketball，开工干净，依赖符号链接不入提交。LOCAL_ONLY / REVIEW，集成人root/c04_result_design整合。只写commerce/wechatpay.ts、wechatpay.test.ts及本文档，不写DB/controller/contracts/共享配置。

## 实现

WechatPayClient默认为disabled，启用须完整appId/merchantId/商户RSA私钥与serial/APIv3密钥/受信平台公钥serial映射/HTTPS无query通知URL。未新增外部凭据，不发真实资金请求。仅Node内置crypto/fetch，不新增依赖。

接口：native({outTradeNo,description,totalFen,currency,expiresAt?})、queryOrder(outTradeNo)、refund({outTradeNo,outRefundNo,totalFen,refundFen,currency,reason?})、queryRefund(outRefundNo)、verifyNotification(rawBody,headers)、downloadBill(date)。订单/退款只返回严格重建的规范证明；退款API的create_time映射createdTime，通知缺该字段则null，绝不把外层通知生成时间当退款受理时间；原始payer/openid、平台错误body和密钥不输出。WECHATPAY_MAX_FEN=100000000。

固定api.mch.weixin.qq.com和APIv3路径，不接受调用者baseURL。请求按method/path-query/timestamp/nonce/raw-body逐项换行RSA-SHA256签名；所有JSON应答（含非2xx）须先原始字节验签、固定serial查受信key、时间±300秒后再解析。拒绝未知serial、SIGNTEST、缺签名、重复头、非规范base64、字节篡改及非CNY/非整数/身份不符。JSON响应最大256KiB、请求及读取10秒deadline、redirect:error。网络超时只返回RESULT_UNKNOWN，不造成功或另换订单号。

回调先验原始body，再验证AEAD_AES_256_GCM及12-byte nonce/AAD/authTag解密。支付仅TRANSACTION.SUCCESS、appid/mchid/NATIVE/原总额；退款事件和refund状态严格一致、mchid绑定。provider层可重复验证相同通知，DB通知ID/交易唯一及报价逐项比对、一次权益授权由commerce service完成。退款受理PROCESSING不当作SUCCESS，固定商户退款号查询/重试；退款原因上限80 UTF-8字节，完整业务理由由service审计保存，不把80个汉字误当80字节。

账单：先验签元数据，下载URL仅HTTPS精确host和/v3/billdownload/file，禁止redirect、文件最大4MiB；官方文件下载属于无响应签名例外，用元数据SHA1核验文件，另给SHA256存证。未请求GZIP，按UTF-8现代ALL账单解析，最多10000明细；处理CSV引号及官方反引号前缀。金额用十进制定点，不使用parseFloat；SUCCESS使用原始「订单金额」，不能误用优惠后「应结订单金额」；官方SUCCESS的退款号双0归null。REFUND的「订单金额」为0.00占位，规范totalFen=null；refundFen取「申请退款金额」，不能误用扣除免充值券后的「退款金额」。旧布局缺原始金额、字段错位、重复交易记录、错误币种/商户/AppID、安全上限或文件hash错误均拒绝。商户账单含其他AppID会fail closed，需在真实商户接入时明确账单范围，不自动混入本系统。

reconcileWechatPayBill(rows,expected)只比较所选账单日的规范明细，报告PROVIDER_ONLY/LOCAL_ONLY/IDENTITY_MISMATCH/AMOUNT_MISMATCH/STATE_MISMATCH及匹配数，不修改支付/权益。service需要提供该日期真实本地支付/退款明细，不能把当前所有订单直接当该日预期。

## 本机验证与限制

API strict、44项协议单测、API build、格式和diff检查通过。测试RSA/AES密钥均在内存即时生成，网络为注入受控Response，涵盖真实签/验/解密、原始字节/merchant/app/币种/金额、退款处理中和最终结果、通知重复、超时、下载SSRF/hash/CSV/定点金额/差异报告。首次39项中的旧账单测试误替换「应结订单金额」子串，已精确替换表头后通过；补5项对账后44通过。完整API源码26文件430项通过。

没有真实商户配置，没有真实支付、退款、商户后台或生产验收；没有DB Migration或真实PG，HTTP rawBody接线、provider结果落库幂等及商业UI由父任务验收。静态协议实现和合成密码学测试不记为真实收款通过。真实开通仍需商户主体、回调域名/凭据及独立授权。

## 官方资料（2026-10-24查阅）

- [Native下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)：检索取得官方字段与期限说明，后续页面open超时如实保留。
- [支付成功通知](https://pay.wechatpay.cn/doc/v3/merchant/4013070368)：签验、AES及重复通知。
- [签名验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053420)：文件下载为响应签名例外。
- [退款指引](https://pay.wechatpay.cn/doc/v3/merchant/4013071031)：固定退款号幂等与最终查询。
- [账单下载](https://pay.wechatpay.cn/doc/v3/merchant/4013071218)：先签名元数据再下载核hash。
- [交易账单格式](https://pay.wechatpay.cn/doc/v3/partner/4013080599)：原始订单金额与应结订单金额不同。

## 独立审查P1与本轮修复

独立审查指出首版合成账单夹具没有覆盖官方SUCCESS退款0号、REFUND订单金额0.00、含券申请退款金额与结算退款额差异，不能以最初44项协议测试证明官方ALL账单兼容。已重新open官方4013080599完整字段核验，并按此修代码及完整27列表头合成夹具。SUCCESS双0归空；REFUND totalFen=null、退款按申请全额；只允许官方账单退款快照状态SUCCESS/PROCESSING/FAIL/CHANGE；汇总笔数须等实际明细数，支持官方自定义字段反斜杠转义引号。

账单按支付成功日或退款受理日出账，退款成功日不是退款账单归属日；状态在出账后冻结。规范Refund.createdTime仅取原资源/API create_time，申请/查询API必须有该字段，通知允许缺失且不推造。service按accepted_at选日、不可变首次补记与原支付ledger比对由父作者负责。reconcile的expected.refundState=null仅表示当前查询状态不能替代历史出账状态，仍严格校验原单/退款双ID和申请金额；若expected明确指定快照状态则严格比较。缺账、错ID、错全额仍输出差异，不自动修复或授权。

新增回归：SUCCESS双0、含券REFUND占位总额/申请额、前日受理PROCESSING账单与次日查询SUCCESS共存、通知outer时间不冒充受理时间、API缺/逆序create_time、错ID/金额/缺账、未知状态、80字节多字节理由边界及官方反斜杠转义。最新50项协议测试、API strict、完整API源码26文件436项及API build全部通过，格式和diff检查通过。本轮继续全部合成内存RSA/AES和注入transport，无真实支付、退款、商户凭据或数据库变更。

补充官方依据：[退款查询受理create_time](https://pay.wechatpay.cn/doc/v3/merchant/4012791884)。
