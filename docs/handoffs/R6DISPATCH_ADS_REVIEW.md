# R6ADS independent review by dispatch implementer

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](../tasks/REMAINING6.md)。

## 历史独立审查记录

以下保留修复前的独立审查发现及其依据；后续修复见 [R6ADS](R6ADS.md)，当前候选验证尚未完成，不把历史问题删除或改写为已通过。

2026-11-01. Read-only inspection of `scb-six-ads` sponsor service/source, migration 047, multi-recipient driver, tests, design and root's additional-source trade bridge. ADS files were not edited. These findings describe the reviewed worktree before the ADS owner applies follow-up fixes.

## P1 — 11 external recipients pass contract scope but cannot ever be dispatched

- `apps/api/src/sponsor-commerce-domain.ts:45` accepts 1–11 total shares. `sponsor-commerce-service.ts:440` checks merchant uniqueness and aggregate percentage but does not require at most 10 external recipients or a retained share when total count is 11.
- `trade-wechat-multi-provider.ts:214` rejects more than 10 external recipients. An approved 11-external contract with sufficiently large positive allocations can therefore reach payment and final settlement, but both send and query fail locally. The channel wrapper records UNKNOWN, and refund preparation blocks an UNKNOWN batch.
- Reproduced without network using `node --import tsx --input-type=module`: domain accepts 11 unique shares totaling 10000 basis points; disabled provider's input validation returns `INVALID_TRADE_INPUT` before any transport call.
- Fix: enforce external-recipient count at contract creation and repeated receiver validation, with 11 total permitted only when including the merchant's retained share. Test rejection before signing/payment.

## P1 — stopping new commerce also stops an existing approved return

- `sponsor-commerce-service.ts:1224` runs `live()` for every non-QUERY channel action. `live()` at line 113 requires `commerce.enabled`.
- Turning off new commerce therefore blocks `SEND_RETURN` for already paid, approved refund obligations, even when the exact historical merchant provider and return capability remain enabled. This contradicts `docs/design/AD_REVENUE_SHARING.md:87` (original queries, refunds and returns remain after new orders are stopped).
- Fix: separate new commercial execution from servicing an existing approved original return; continue to enforce the pinned merchant, original receiver, plan/amount, explicit finance permission and restore quarantine. Test enabled-at-payment then disabled-at-return. Do not relax restore isolation.

## P1 — large refunds can wait on final unfreeze while final unfreeze waits on refund success

- `sponsor-commerce-service.ts:1269–1281` permits FINISH only for SUCCEEDED batches and rejects it while a non-rejected plan lacks a SUCCEEDED common-ledger refund. `PROPOSE_REFUND` at line 934 does allow SUCCEEDED/PARTIAL batches, and refund allocation/dispatch guards require the relevant successful receiver returns to be confirmed first.
- Ordinary WeChat merchant guidance says a full refund after partial distribution, or a partial refund exceeding the still-frozen undistributed funds, first requires unfreezing the remaining funds; returned receiver money enters the merchant's available balance, not that original frozen balance. See the official [profit-sharing FAQ](https://pay.wechatpay.cn/doc/v3/merchant/4014547102), “分账退款逻辑” and “调用分账回退接口，回退的资金会到哪”, verified 2026-11-01. [Unfreeze API](https://pay.wechatpay.cn/doc/v3/merchant/4012526374) confirms asynchronous completion queried by original order.
- Example: paid 100, distributed 30, frozen remainder 70; customer refund 100; receiver return 30 succeeds. The channel refund requires unfreeze first, while the application refuses FINISH until that refund succeeds. Terminal PARTIAL/CLOSED receiver items also lack any permitted final-unfreeze path.
- Fix: an explicitly approved refund-unfreeze operation/state after per-item terminal verification and the required return evidence. It must use the original financial order/merchant, retain PARTIAL differences and any obligations, and never mark failed recipient payment as successful. Common-ledger refund dispatch should require the resulting channel-confirmed unfreeze when needed. Test a provider double that refuses the large refund until unfreeze is confirmed; a fixture that simply stamps refund success does not cover this dependency.

## Reviewed controls that are already present

- Contract creation/signature identity, immutable shares, independent finance reviewers, distinct higher-risk approvals, frozen verified fees, pinned historical merchant, common-order/calendar locks, original command receipts and dispatch fences.
- Integer largest-remainder payout plus monotonic cumulative refund allocation; one active batch, one pending refund, success-retaining DB guards; UNKNOWN results keep original identifiers and do not manufacture financial success.
- Root additional-source bridge blocks legacy single-recipient settlement and generic refunds for sponsor sources, binds exact approved allocation to a common refund, and rechecks it before actual refund dispatch.

This review is not a production approval. No real funds or external requests were made. PostgreSQL and combined recovery validation are being run by the root's isolated CI.
