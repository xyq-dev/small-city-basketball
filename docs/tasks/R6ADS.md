# R6ADS 广告合同与多方结算

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

状态：REVIEW；integration：BRANCH_ONLY。2026-11-01 Asia/Shanghai。

负责人：/root/implement_ads；集成人：root。目录 `/workspace/scratch/aad368826b09/scb-six-ads`；分支 `work/r6-ads`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，开工工作区clean。远端为本项目GitHub，真实快照由root核验导入。

范围：独立广告商业合同/订单/交付/结算/回退追偿PG模块、新多接收方微信driver、小程序入口与定向测试；只写分配的`sponsor-commerce-*`、`trade-wechat-multi-*`、合同、047迁移和本任务文档。root负责统一trade新来源、app、菜单、恢复及共享文档接线。

权限：本地开发、定向测试和本任务commit；远端同步由root执行。不部署，不执行生产迁移，不真实收款/分账，不配置新凭据。001—042不改。

验证计划：分配/退款单调性、严格请求和响应、组织/受益权限、独立审批、UNKNOWN原单查询、同源金额上限与PG并发；真实PG测试待隔离CI，商户实款联调未执行。默认新收款和结算关闭。

检查点：已核对既有trade与赞助实现；现有单接收方driver不可循环用于多人分账，新来源必须统一纳入trade。

2026-11-01 第二切片：真实PG service/controller、source/refund hooks、多接收方签名driver、广告管理/广告主验收/受益报表小程序、回执取消防迟到写及5条PG场景已实现。定向领域与transport单测14/14通过；小程序金额/路径/超时保护/隐私生命周期5/5通过；API typecheck通过。PG集成仅编写待root隔离CI，不声称本机通过。共10表；真实商户未配置，默认关闭。平台垫付需要额外可信资金覆盖校验，作为下一切片，当前不能凭审批绕过失败回退。

2026-11-01 接线修正：根审阅指出无chargeConsent可能生成无法支付的孤立订单；现广告主明确同意且capture统一trade返回真实orderId才可提交，否则事务回滚。UI按钮说明收费授权，退款bridge类型保留PENDING/SUCCEEDED/FAILED/UNKNOWN。对应PG夹具改为统一capture hook建源关联订单；真实支付仍仅合成渠道事实。

2026-11-01 独立审查修正：移除垫付草稿时，dispatch guard的参数数组遗留第二值而SQL仅$1；已修正为精确单参数。真实PG场景在CLAIM后调用此guard并补错金额拒绝断言，等待根CI执行；不以本地tsc冒充PG通过。

2026-11-01 恢复切片：新增`scripts/r6-recovery-sponsor.mjs`，runtimePool明确合成fixture填满10张新表，2份真实合同/广告订单绑定canonical SPONSOR_ORDER trade支付，保留UNKNOWN统一退款+原成功回退、失败回退+OPEN追偿；同步048不可变refund binding。无渠道调用、无凭据。node --check通过；真实备份恢复演练由root/map隔离CI执行。

2026-11-01 注销资金核验切片：`readSponsorClosureFunds(c,sourceId,tradeOrderId)`从共同支付/成功退款、原批次、逐项已实付/商户留存、实际成功回退及核验手续费重算dischargedFen。仅已CLOSED且精确等于paid-refunded才允许根通用guard扣减；未知/未结束/差额/缺凭据/追偿未结/垫付不可解释全部unresolved。PG增加完整分账结清、全额退款结清、UNKNOWN三分支，待根真实CI；API typecheck通过。

2026-11-01 分账/退款审查切片：服务与driver统一最多10个外部商户；新单关闭不阻断已批准原回退与原退款解冻。新增REFUND_UNFREEZE，所有项终态、退款独立审核及成功份额回退核验后先原F编号解冻，确认后才可CLAIM统一退款；PARTIAL保留原差额状态，不伪改全成功。解决普通商户大额/全额退款必须先解冻与FINISH等待退款的循环依赖。

可信垫付：默认关闭，必须原商户ownFundsRefundSupported、同事务可信reserveAdvanceCoverage原订单锁额、双人finance审核和冻结coverage receipt；receipt绑定原merchant/payment/order/allocation/full amount/CNY及独占reservationId，直到原refund终态。无checker、错绑定、纯口头证据均拒绝。原FAILED回退/OPEN追偿仍保留，绝不当实际退款。恢复fixture仍默认RETURN_FIRST。

验证：领域/签名transport16/16，微信5/5，API tsc/diffcheck通过；真实PG扩至8项测试（其中含多个资金子场景），新增full refund先回退/解冻、PARTIAL解冻、关新单后历史回退、11外部拒绝、无覆盖/跨单覆盖拒绝与不可变覆盖证明。PG仅代码已准备，等待rootCI。

2026-11-01 一致性小片：047不可变trigger改为按表独立IF分支再读取各表专属record字段；PARTIAL批次全额退款/真实解冻后FAILED分配项只能净零解除，不计失败金额为已付。PG追加该全退注销断言；恢复UNKNOWN退款夹具同步原batch先finished的不变量。API tsc及恢复script语法通过，PG待CI；前文PG数量更正为8条test。

2026-11-01 在途事实收敛：机构在已批准发送后被停用，已验签/已校验渠道回包仍按原fence记录（仅machine result允许inactive，用户操作依旧需有效权限）；原provider分账/回退ID不接受漂移。PG新增停用发生在transport内的实据落库场景，现9条PGtest待CI。垫付预约也明确受restore quarantine拦截。

2026-11-01 CI150真实PG反馈：8个广告场景在合同时间边界setup失败。根因是pg返回Date对象，Date.parse(Date)先转本地字符串会丢毫秒，导致同一endsAt ISO毫秒被误判越界。已改new Date(dbTimestamp).getTime()保留原毫秒；未放宽合同必须在投放时段内的约束。等待下一轮真实PG。

2026-11-01 广告主入口切片：新增GET /v1/me/sponsor-commerce，仅按当前actual payer_user_id返回本人合同摘要与所属机构；普通账号不需要任何机构管理角色，也不需要手输orgId。小程序合并本人获授权合同机构与管理机构，收费授权/签署/支付沿同一入口。已加普通payer无有效机构membership的PGhappy-path与陌生/受益账号隔离断言（现10条PGtest待CI），微信VM新增无管理角色完整进入→建立收费订单路径；微信6/6与tsc通过。

资金权限修正：历史merchant仅保留原资金路由，finance校验始终取当前owner org配置名单及当前有效owner/admin/fresh session，不能借旧merchant保留已撤销财务权限。

2026-11-01 CI151真实PG反馈：8条广告测试中7条核心资金流程通过，剩1条fixture将跨租户隐藏资源误期待403，实际正确返回404/RESOURCE_NOT_FOUND；已修断言，不放宽生产授权。较新的普通广告主/inflight扩展测试待后续CI。

2026-11-01 真实交易桥验收强化：全部广告PG场景改为真实TradeService + remainingSixTradeSources；captureSourceCharge/captureSourceRefund直接调用共同账本，不再手写trade订单或退款stub。支付/分账/退款transport仍纯合成。新增并发同CLAIM只有1个immutable binding+1个common refund、直接共同bridge并发重放、真实独立review/dispatch、派发前UNKNOWN回退阻断且不调用provider、先F解冻后共同refund成功及重放返回SUCCEEDED。新增测试在根集成checkout执行，当前隔离分支基线未含root adapter，动态导入目标固定为repo内真实文件而非mock；无跳过。

渠道整数上限：合同创建、实收分配提案和发送前均核external整数分总和<=floor(original payment × approved max bps / 10000)。10003分30%最大余数3001分不再越过3000分渠道额度；不修改分配算法。合成merchant授权上限改3500bps，合同分成仍3000bps。新增整数边界单测。真实PG新增至11test，等待根新CI；API tsc通过。

2026-11-01 小程序顺序收尾：退款卡先展示所需原批次解冻，解冻确认后才展示提交统一退款；已结束原批次不重复给出解冻操作。机构管理员可在页面直接切换“本机构收益明细”，无需手写mode；换登录账号清除旧org/order选择。微信6/6及WXML处理器校验通过。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。

2026-11-01 恢复身份修正开工：按root指派基于1132731047edd8abad47eb3b0450d350f9f4b801新建`/workspace/scratch/aad368826b09/scb-six-ads-recovery`、`work/r6-ads-recovery`，起始clean；远端仍xyq-dev/small-city-basketball。仅`scripts/r6-recovery-sponsor.mjs`及本任务/交接文档，允许本地验证与commit，远端与CI由root执行。修复SQL合成恢复样本错误地把完整source写入共同trade快照、并用排序sponsorHash代替tradeHash的问题；两单现在与真实TradeService一致存source.identity及tradeHash(identity)，每次capture/restore/quarantine快照同时只读核验两份源身份及共同hash。仍明确为SQL合成恢复样本，不声称该脚本通过真实商户支付流程；实际TradeService PG链路验证另有独立测试。

该小片验证：`node --check scripts/r6-recovery-sponsor.mjs`、Prettier单文件检查及`git diff --check`通过。独立只读审查逐一比对18类INSERT目标与`runtime-privileges.json`、047/048及原trade约束，除已修身份问题外未发现确定ACL/外键/状态约束阻断；未在本机执行PG或恢复，完整恢复交root CI154。源身份复核只使用SELECT，兼容备份指纹只读账号，不增加权限。

2026-11-01 新审查开工：root指派PR35的XCaZ/XCab/XCac/XF3m，基于87a8bcb在`/workspace/scratch/aad368826b09/scb-six-ads-review`、`work/r6-ads-review`开工，起始clean，远端不变。允许ADS专属服务/source/047/UI/测试及自身文档；共享privacy由insurance、ACL/trade由root。前三项已实现：未付关闭先money实查，再核canonical身份/零资金/已终止checkout及无交付计划；0fen外部分配用受CHECK约束的NOT_REQUIRED而非渠道成功，全部外部为零时不调用分账但仍要求真实解冻；API明确currentBatchId并逐批返回items，UI明细不再误用被拒旧批次。新增3项真实PG测试含未付/UNKNOWN/NOTPAY/DISPATCHING拒绝、1分钱零外部真实解冻、拒绝后替代批次显示。PG待root隔离CI。

退款恢复设计已获root确认：新增sponsor_refund_retries独立审核与前驱链，原CLAIMED/退款/binding/成功回退全部冻结保留；仅明确FAILED/REJECTED可提议，UNKNOWN阻断，每层重新审核和派发前重核前驱迟到成功，未提供新可信资金预留前禁止垫付计划恢复。此第四项独立后续切片，不以人工债务说明替代可操作流程。

2026-11-01 未建单签署补充：CLOSE_UNSTARTED须现行finance与fresh session、SIGNED状态、原合同锁内查无任何sponsor_order，才改CLOSED；签署人、时间、金额条款及哈希完整保留，已有订单必须走CLOSE_ORDER。UI增加核验关闭按钮；PG覆盖普通payer拒绝、无单成功且不可再建单、已有单拒绝。未付canonical如已SOURCE_CONFLICT仍阻断关闭/注销，不能把冲突当零义务消除。

2026-11-01 退款恢复实现检查点：新增第11表`sponsor_refund_retries`，金额/原支付/计划通过不可变同源链核对；提议、独立finance批准、CLAIM_RETRY均重新确认全部前驱只有明确FAILED或无外发REJECTED，并复用原计划已经完成的return，不复制分配或回退。原CLAIMED及binding始终不改；拒绝恢复草稿或未claim的APPROVED后可再提，common拒绝后可沿新叶继续独立审核。PLATFORM_ADVANCE没有新reservation协议，恢复明确拒绝，不能挪用旧覆盖证明。

`readSponsorRefundResolution`统一判断链，CLOSE_ORDER、分账、后续退款、source分配/派发和closureFunds使用一致事实。任一祖先迟到SUCCESS时新外发被阻断；源APPROVED尚未claim可显式独立拒绝，已经CLAIMED的未发共同退款由共享assertRefundRevocation入口撤回。保留SOURCE_CONFLICT历史标记；仅完整canonical身份/唯一PAID、全链恰好一个实际SUCCESS、其它确定未实退终态和return/金额精算无差额的已付单允许结清；未付冲突仍阻断。未知、第二成功或未决审批不能被忽略。

恢复样本将原UNKNOWN退款改为原FAILED＋明确审核的retry UNKNOWN，原返回证据不变；11表非空、原/替代两binding及同支付同额关系纳入snapshot。quarantine不修改新表历史，所有retry写操作受恢复标记拦截。UI增加恢复凭据、独立批/拒、统一审核入口；已CLOSED历史订单仍可处理原失败义务。

本片已跑API tsc、领域/签名transport17/17、微信6/6、恢复script node语法与diffcheck通过。PG现18条test：新增真实common发送CLOSED→源拒审再提→common拒审再提→并发唯一claim→真实SUCCESS且return hash不变；PROCESSING拒重试；恢复隔离拒new/approve/claim且可读；源APPROVED迟到成功后显式撤回；真实queryRefund迟到成功→共同余额冲突→未发替代撤回→精确闭账。最后一条依赖matching共同退款安全撤回及root adapter接线，本地无PG，实际通过与否待根新CI，不以tsc替代。

2026-11-01 CI156真实PG反馈：本模块18项中17项通过，包括全部新增退款恢复、真实迟到成功撤回及零金额/未付闭账。唯一失败是未建单关闭测试把普通payer无管理membership的隐藏资源404误期待403；不改生产授权。测试已拆成独立signedContract与各断言，覆盖payer404、同机构非finance owner403、拒绝后合同/命令回执不变、finance关闭保留签署、旧version拒绝与最新version已关闭状态拒绝、业务与共同订单均零行。此前嵌套expect不再把内层AssertionError包装成版本失败；API tsc/格式验证后交下一CI。
