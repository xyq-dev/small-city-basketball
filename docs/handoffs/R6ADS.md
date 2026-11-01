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

PG验收去stub：现所有商业订单和退款都用真实TradeService配remainingSixTradeSources({sponsorEnabled:true})捕获；唯一人工注入的是明确synthetic PAID渠道事实，未替代source读取/quote/订单/退款/binding。新增真实common review→dispatch→applyRefund成功，provider若未F解冻拒绝；UNKNOWN回退在出网前阻断，spy退款次数不增；并发CLAIM与共同capture重放只有一条binding/refund。原fixture stub方式的7条资金测试通过不等于此更强桥接测试已过，需根当前CI确认。

实际fen渠道限额统一在createContract/proposeSettlement/SEND_SPLIT检查，不仅检查bps比例。不能因最大余数取整在付款后卡住不可发送分账；测试合成35%渠道授权仅用于合法验证30%分成算例，不代表生产账户获批比例。

页面顺序补丁：beneficiary报表有内置tab，普通advertiser不显示管理收益tab；needsUnfreeze从真实batch.finished推导，仅影响按钮顺序，后端仍独立强制检查。切换用户重置旧机构/订单引用，防止界面停留在另一账号选择。

2026-11-01 恢复身份小片：基于root 1132731，新worktree `scb-six-ads-recovery`、分支`work/r6-ads-recovery`，只改恢复脚本和R6ADS记录。共同trade恢复样本应存`source.identity`、`tradeHash(source.identity)`，不使用完整source或广告领域排序hash。快照对两单重新投影冻结身份并断言source_snapshot深等及source_hash一致；readPool仅SELECT，不调用带FOR UPDATE的source helper。SQL合成样本声明保持，真实交易桥PG验证与完整隔离恢复CI继续分别记录。

本片node语法、单文件Prettier、diff检查通过；独立只读ACL/数据库约束审查无新增确定blocker。没有生产/新Migration/运行权限调整，未本地执行PG；请root纳入CI154完整备份恢复验证。两单ASSERT在初次capture、重启、恢复及quarantine复核均执行，能拒绝原先“全source快照＋排序hash”的错误样本。

2026-11-01 PR35追加审查前三项：基线87a8bcb、新worktree scb-six-ads-review。未付款的CLOSE_ORDER不跳过money，使用同一canonical/全资金与义务查询证明零金额结清；readSponsorClosureFunds维持tradeId必传，缺统一订单仍阻断。零外部项NOT_REQUIRED严格等价amount_fen=0且非retained；shared privacy由insurance纳入此严格终态。get返回currentBatchId、每batch.items以及兼容current items，页面按批次分组；拒绝后的旧记录保留。新增PG边界等待根CI，本机不声称PG已跑。第四项retry表/审核链已获root方案确认，稍后另片交付。

2026-11-01 未建单签署补充：CLOSE_UNSTARTED须现行finance与fresh session、SIGNED状态、原合同锁内查无任何sponsor_order，才改CLOSED；签署人、时间、金额条款及哈希完整保留，已有订单必须走CLOSE_ORDER。UI增加核验关闭按钮；PG覆盖普通payer拒绝、无单成功且不可再建单、已有单拒绝。未付canonical如已SOURCE_CONFLICT仍阻断关闭/注销，不能把冲突当零义务消除。

2026-11-01 retry交接：新增表`sponsor_refund_retries`列id/org_id/order_id/plan_id/previous_refund_id/status/evidence/proposed_by/reviewed_by/trade_refund_id/version/created_at/updated_at。状态IN_REVIEW/APPROVED/CLAIMED/REJECTED；runtime只需SELECT/INSERT及UPDATE(status,reviewed_by,trade_refund_id,version,updated_at)，quarantine字段空集。复合FK绑定plan到同org/order，唯一前驱后继排除REJECTED，pending每plan一条。保留原计划、金额、回退、审计及不可变binding。

新增命令PROPOSE_RETRY(planId,evidence)、APPROVE_RETRY/REJECT_RETRY/CLAIM_RETRY(retryId)；新allocationId为retryId，统一capture接口不变。source新增`assertSponsorRefundRevocation(c,sourceId,allocationId,amountFen)`，root将其注册adapter，matching负责common未发APPROVED退款显式REJECT与GET balanceConflict视图；hook只核事实并读取锁，不改资金。统一`readSponsorRefundResolution(c,planId)`在新sponsor-commerce-refund-resolution.ts；privacy由insurance调用closureFunds并锁retry链，root整合其d2e4a57。

本片替代前文“FAILED/REJECTED后无恢复入口”的旧限制：现在有显式可审计、逐层独立批准的恢复流程，仍绝不自动换号或对UNKNOWN重试。原祖先迟到SUCCESS后，后继必须显式拒绝或有确定渠道FAILED证据才能结束；任何在途/第二SUCCESS继续阻断，SOURCE_CONFLICT标记保留。平台垫付重试仍禁用，因为旧allocation-bound资金预留不能复用。

恢复capture新增非空retry及原FAILED/当前UNKNOWN两common退款、两binding；snapshot严格同源同额同支付且新表完整不可变hash。18条PG场景已准备，17领域driver/6微信/tsc及nodecheck/diffcheck通过；真实PG/完整恢复待根CI。root须同步ACL、新表inventory（总221）及shared revocation wiring后再运行。
