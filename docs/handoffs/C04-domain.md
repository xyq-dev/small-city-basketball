# C04 纯淘汰赛算法与权威投影

2026-10-23（Asia/Shanghai）；负责人/root/c04_domain；REVIEW / LOCAL_ONLY。独立目录/workspace/scratch/dc6a786e1a31/c04-domain，分支feat/C04-domain，基线4b48997，远端原仓库。仅新增knockout-domain.ts、knockout-domain.test.ts及本记录；依赖node_modules三个symlink未追踪，不纳入交付。不提交、不推送、不执行Migration或生产操作。

## 实现

- generateKnockoutPairings：SE_SEEDED_V1；canonicalFreeze/原排赛政策复用；256bit seed按sha256(seed|entryId)稳定抽签、standard seedpositions(1,8,4,5,2,7,3,6等)分散首轮轮空；只生成首轮真实fixtures，无轮空比赛。输入不变异、原RR算法不改。
- calculateKnockout：原正式比赛+当前确认只读投影；严格冻结event/publication/同revision/双方team/name/roster/计划身份；已发布轮必须完整，不跳轮、不造bye match；只有有效独立确认可产生winner。复用confirmedResult+confirmedPlayerStatistics；PLAYER_BASIC名单再与冻结players身份/姓名/号码精确比较。淘汰赛state强制OVERTIME，FINAL不得平分。直接子赛不得早于任一实际父赛结束。
- 完整括号含BYE/WAITING，轮空自动传递队身份；nextRound只在前轮全部实际场有效确认后出现。最终n−1真实比赛全确认后才给冠军/亚军/同轮淘汰共享名次，不设三四名赛。
- roundPublications可选但缺省[]只适用首轮；每个已有后轮必须恰一凭证，sources精确等于上一轮全部当前确认身份/确认生效版本/winner；缺失/重复/额外/旧确认均409 RESULT_SOURCE_INVALID。不能只凭同winner的新确认认可历史晋级。
- sources.matchVersion固定为cf.source_match_version+1即确认生效版本；原工作人员维护可递增m.version/state.source_version，不改变确认来源，也不会误废既有下游。真正重确认cf.id改变仍会使引用失效。sourceHash确定性且不含asOf/未确认live比分时钟，包含冻结抽签/当前计划/有效确认与历史sources。

## 实测

- `npm run test --workspace @small-city-basketball/api`：24文件375源码测试通过（当时新增62）；最后增加子赛时间下界及1项回归后，`../../node_modules/.bin/vitest run src/knockout-domain.test.ts`：本文件63项通过。
- 最终`../../node_modules/.bin/tsc --noEmit`（apps/api）：通过；两新源码Prettier、git diff --check通过。
- 63项覆盖2–32队初轮不变量、2/3/5/17/32队完整n−1全树、已知三队签位、输入重排/不变异/政策与抽签hash、未确认与轮空、完整轮次/历史proof、旧确认/平局/伪造回执及冻结球员身份、安全staff版本、子赛时间下界。
- 这些是本机源码纯函数/strict证据，不是真实PG/浏览器或生产。真实PG/独立审查由root整合后隔离CI执行。

## 交接

两新源码已冻结可按允许路径复制整合；其他API代理曾复制联编依赖，不应重复纳入其作者diff。下一步root先整合两文件，再联编调度/结果/UI/PG与真实恢复驱动。未改任何旧Migration，无生产/外部凭据/付费/公网变更。完整商业版其他模块、原生OBS和旧007已落库FINAL升级缺口不由本纯算法卡宣称完成。
