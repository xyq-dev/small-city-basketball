# C05 商业真实HTTP重启/恢复驱动增量

2026-10-24（Asia/Shanghai），/root/c04_domain，REVIEW / BRANCH_ONLY。在原c05-wechat独立分支追加scripts/c05-commerce-check.mjs；不写root原checker/Compose/CI，微信已提交产物与3个依赖symlink均保留。仅本模块及交接单独commit，不push。root负责调用位置、隔离临时凭据挂载与整体验证。

导出captureCommerceSetup({call,databaseUrl,maintenanceUrl})、ensureCommercialEntitlement({call,cookie,orgId,eventId,setup})、captureCommerceEnd({call,cookie,orgId,eventId,setup})、verifyCommerce({call,saved,cookie,orgId})。call按现有checker返回{data,response}。直接import正式compiled maintainPlatformOperator helper；除这一维护helper赋2个合成operator外，业务全部原HTTP API，无直写业务表。自建维护短pool在finally关闭，不接管root API/runtime/fingerprint pool。

setup严格URL协议、同host/port/db、host仅localhost/127.0.0.1/[::1]/postgres/db、dbname必须scb_test_*、拒hash及host覆盖查询参数；再实际查询current_database与非recovery。不会因为NODE_ENV=production拒绝真实隔离生产模式，但禁止生产/外部数据库目标。根call回调仍须由既有local/隔离TLS baseUrl guard提供，不能把本模块接到外部生产HTTP。

HTTP POST注册2位无机构/球队的临时participant，官方维护helper授予独立平台资格；平台创建100fen/CNY、32队、1024场、730天方案。每届用原event CAS下单→op1 SUBMIT_PAYMENT→op2 CONFIRM_PAYMENT，断言原quote/PAID/独立双人/原owner非复核员，检查真实持久权益。只MANUAL合成reference，不发真实支付/查单/退款。

end在root提供的未发布draft单独购买权益→owner REQUEST_REFUND→op1提交→op2复核全额退款，断言REFUNDED/SUCCEEDED/100fen/原请求者与双方身份、权益撤销且无激活。其它已购正式赛事逐一断言PAID并绑定各自entitlement和PAID activation，不能仅一个事件成功就混称全通过。

从平台workspace读取全部本地MANUAL交易：支付行用paymentReview.externalReference与paidAt上海日期，退款行用refund.externalReference/completedAt（非payment reference或out_refund_no）。按实际上海日期分组，生成canonical CSV调用真实HTTP MANUAL对账，逐份issues=[]且matchedCount严格等于行数。订单列表达到API上限100即failclosed，不静默截断。保存组织及平台账单/不可变报价/人工双人复核/权益/激活/退款/对账事实，以及2个operator的cookie/userId供原state私有文件保存。verify只读HTTP核验原会话身份/无机构权限，精确比较全部事实；排除时间相关capabilities，不以新一次付款替代恢复验证。应在quarantine前运行，quarantine由root撤销旧会话/身份与权限。

本机已实际node --check与Prettier通过。没有PG/Docker，未执行capture或verify，未将语法或模拟协议检查记成真实财务、PG重启或完整恢复。下一步root整合此提交，传隔离migrator secret、COMMERCE_MODE=ENFORCED，首次赛程发布前逐届调用ensure，全部业务链结束后调用end保存，重启/恢复后verify，再对旧权限做quarantine负向断言。无生产/真实外部付款/新凭据配置。
