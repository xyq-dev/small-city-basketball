# R6ADS 交接

2026-11-01：IN_PROGRESS / LOCAL_ONLY。基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，工作树及权限见任务卡。

root需接线SPONSOR_ORDER source、禁止该来源使用旧单方结算入口、退款必须绑定已核验的广告退款计划；新模块提供源读取和退款关口函数。新047迁移仅编写，不在生产执行。当前没有商户真实验证。

第二切片接口：`SponsorCommerceService(pool, ApiOptions, SponsorCommerceOptions)`、`SponsorCommerceController`、`SCB_SPONSOR_COMMERCE_SERVICE`。配置默认`enabled:false`；merchants按owner org绑定key/merchantId/appId/maximumSplitBps/financeActorIds/receivers/provider，历史商户按`org:key`保留；审核人还须当前机构owner/admin及fresh session。独立受益商户须server配置与`sponsor_beneficiaries`双重授权匹配。服务不把城市投放审核权限当资金审核权限。

桥接：`sponsorSourceReference`、`readSponsorTradeSource`（termsId:null、consentId:contractId、requiresProfitSharing:true）、`claimSponsorRefundAllocation(c,{sourceId,allocationId,amountFen,refundId})`、`assertSponsorRefundDispatch(c,sourceId,allocationId,amountFen)`。统一退款钩子在同一事务生成trade_refunds，再走统一独立审核和渠道发送；未回退的款项不会冒充退款成功。

新driver `TradeWechatMultiClient`（`trade-wechat-multi-provider.ts`）：普通商户固定域名签名、平台响应验签、商户全称RSA-OAEP加密、一次发送最多10个外部接收方、`unfreeze_unsplit:false`、逐项状态与身份金额校验。全部分项确认后单独 `/v3/profitsharing/orders/unfreeze`，固定split编号追加F用于结束操作，UNKNOWN仅查询原编号。不修改旧单接收方driver。官方依据：4012524936、4012526374、4012525287，2026-11-01在线核对。合成密钥只在测试进程生成。

页面：`pages/sponsor-commerce/index`；`?orgId`进入广告主合同，`?mode=statements`仅受益机构记录，默认机构管理。`utils/sponsor-commerce.js`导出`sponsorCommercePathAllowed(path,method,query,uuidPattern)`供root allowlist；contracts只共享新d.ts由root导出。root负责app/providers、菜单、交易来源、恢复和账户注销；本agent不修改共享文件。

047当前表：sponsor_beneficiaries/contracts/orders/deliveries/settlement_batches/settlement_items/refund_plans/return_items/recovery_cases/commerce_operations；唯一函数`r6_sponsor_immutable()`。退款计划/分账项均独立不可变intent；命令证据append-only。API权限/金额并发/UNKNOWN/回退失败/来源稳定PG测试位于`apps/api/test/r6-sponsor-commerce.integration.test.ts`，本地未配置PG，等待集成CI。恢复专项脚本另行交付。

接线修正：createOrder必须chargeConsent===true，capture hook必须存在且返回orderId；acceptedTermsId传冻结contractId。不会留下无统一trade的成功广告订单。captureSourceRefund返回四态类型已修正，未转成固定PENDING。平台垫付仍未启用。

dispatch guard参数修正：SQL `$1`与`[p.id]`一致，现无未接入垫付字段；PG测试含成功绑定调用与错误金额拒绝。该错误由并行审查发现，已独立修正，垫付下一片必须可信coverage。

恢复模块导出`captureR6Sponsor(context)`与`verifyR6Sponsor({readPool,saved,quarantined})`。允许原通用trade隔离变SOURCE_CONFLICT/version，受益授权DISABLED，合同/order版本递增，分账/回退SENDING→UNKNOWN及fence清空；冻结金额/原编号/成功事实/追偿不能改。新分账与回退事实属于sponsor_settlement_items/sponsor_return_items，不往旧单接收方trade_settlements重复登记收入。脚本以只读哈希及关系join证明两套事实同源。

根可将`readSponsorClosureFunds`注册adapter.closureFunds：须原calendar/common trade_order锁；函数再次锁同源单据和子表，净额使用累计退款的精确单调分摊重新核对每一收款人的实际回退。没有跳过通用注销资金检查，所有失败均返回{dischargedFen:0,unresolved:true}。当前平台垫付策略默认不计可注销资金，保守阻断。

普通商户官网FAQ4014547102已由并行审查核对：回退进入可用资金，已分账的大额/全额退款可能要求先解冻。新channel action `REFUND_UNFREEZE` 的childId是refundPlanId；`QUERY_FINISH`的childId仍batchId。使用同一原splitNo+'F'；全部SUCCESS/RETAINED/FAILED终态可解冻，PARTIAL不改成功。source assert/dispatch均强制原batch已finished，故不能先生成/发送统一退款再无限等FINISH。无分账的原单退款无需此步骤。SEND_RETURN/REFUND_UNFREEZE允许enabled=false下继续已批准历史义务，仍检查原商户、returns能力、restore quarantine。

047新增refund_plans列：funding_mode、advance_proposed_by、advance_reviewed_by、advance_evidence、advance_coverage，需root grant UPDATE该5列。新唯一索引sponsor_advance_reservation_unique；coverage不可变JSON，无新表/函数。`SponsorCommerceOptions.reserveAdvanceCoverage(c,binding)`仅可信服务端同事务锁定原订单自有资金；binding={sourceId,allocationId,tradeOrderId,paymentId,merchantKey,merchantId,currency:'CNY',amountFen}，返回还须reservationId/proofHash及channelSupportsOwnFundsRefund/reservedUntilRefundFinal:true；相同reservation不可跨计划复用。生产没有checker默认不启用；不可用客户端凭据直接声称余额。`SponsorMerchant.ownFundsRefundSupported`还须显式true。自动释放/跨订单余额不受支持。CLAIM时将覆盖用于真实trade退款前置，不创建虚假到账；追偿仍独立OPEN。注销hook对垫付暂保守unresolved。

恢复脚本补丁：CLAIMED/UNKNOWN广告退款样本已有原F批次解冻确认，避免构造当前状态机不可达的退款。另一失败回退+OPEN追偿样本不解冻不claim。注销支持已全额退款的PARTIAL：每个FAILED项必须全额NOT_REQUIRED分摊解除，任何剩余失败应付仍unresolved；不改原PARTIAL状态。

独立审查后进一步保留在途事实：recordChannel可在原机构停用后落库，防实际已分账被组织状态变化丢失；不会扩张用户finance权限。原fence被恢复隔离清空时仍拒迟到写。canonical refund的FAILED/REJECTED保留原义务，模块不自动换新binding重试或二次回退，需共同ledger显式最终失败替代协议；UNKNOWN只查询原号。

CI150证据：广告真实PG 8场景均在共同fixture合同时间边界失败，尚无PG通过声明。已修Date.parse(pg Date)毫秒丢失，用精确epoch毫秒比较，合同/投放边界不变。已知限制：统一退款确定FAILED/REJECTED后仍保留义务，需人工核对，未提供自动新号替代；不得绕开唯一binding重发外部请求。

根接线新增`SponsorCommerceMeController`（同`sponsor-commerce-controller.ts`/同SCB service token），路由GET `/v1/me/sponsor-commerce`；own path helper已放行该GET且拒查询参数/写方法。根账户页须给所有登录用户“我的广告合同”入口，不只管理员。返回`SponsorCommerceInboxData`（新contracts类型）：organizations[{id,name,role:'ADVERTISER'}], contracts仅本人分配记录, truncated。页面无query也可由server获授权机构，具体org页依然二次校验actual payer或manager。普通payer fixture已禁用其无关org membership，确保不是偶然借owner身份通过。

CI151已确认此前广告8测试的7条资金闭环通过；剩余失败是跨租户get应隐藏资源的测试期待，改为404/RESOURCE_NOT_FOUND。生产权限未改变。最新inbox与额外生命周期场景仍须按根实际CI结果判断。
