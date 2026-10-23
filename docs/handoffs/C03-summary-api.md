# C03 私有球员数据榜 API 交接

2026-10-23 06:20（UTC）；实施者 `/root/c03_player_summary_design`；REVIEW / LOCAL_ONLY。

基线 `909fb74fcc702baded0d70ce5c6cde6d5a7ddddd`，工作树 `/workspace/scratch/dc6a786e1a31/c03-summary-api`，分支 `feat/C03-summary-api`，origin 为原 `xyq-dev/small-city-basketball`。开工只存在集成人冻结的 `packages/contracts/index.d.ts` 镜像差异，予以保留，不作为本实施者交付。遵守 root 分工，不修改 app.ts、现有 scoring/standings 服务、合同、manifest、脚本或共享状态文档；不执行 Git 写操作或生产操作。

## 范围与检查点

已编写共享 `confirmed-player-statistics.ts`（生命周期复用）、私有汇总 domain/service/controller。只读原始当前独立确认，无新表或可写比分副本。actor→org→event→event_staff 锁序，管理员或该届实际工作人员才能读，单场人员不扩权。正式赛程来源、全部确认证明和冻结名单在一个 PostgreSQL statement snapshot 读取。无正式赛程 summary=null；现有单循环正式赛程损坏则 409。有效 PLAYER_BASIC、TEAM_ONLY 和待确认分开计数；重开退出、重确认更新，不把名单样本数称作出场。得分共同排名，不以犯规破同分。hash 不含 asOf/event 生命周期状态。

已与 root/UI 冻结：coverageComplete=total>0 && included===total；attributionComplete=included>0 && 无未归属分/犯规。teams 保留正式赛程全部球队，数字仅为已纳入 PLAYER_BASIC 样本合计；没有样本时不表示整届球队分数为零。

## 交付与已运行检查

- `apps/api/src/confirmed-player-statistics.ts`：共享纯验证 helper，复用 confirmedResult；模式一致、准确 C02 DTO 白名单、当前 state/confirmation 相等、个人和未归属之和等于确认球队总分/犯规，坏源统一 RESULT_SOURCE_INVALID 409。生命周期作者复用，不另开事务。
- `apps/api/src/event-player-statistics-domain.ts`：固定 entry+revision+member 身份、源名单和球队匹配、覆盖统计、逐人及未归属合计、得分共同名次和确定性 sourceHash。
- `apps/api/src/event-player-statistics-service.ts`、`event-player-statistics-controller.ts`：既有权限及锁序；原始赛程 source、全部最新确认证明与冻结 roster 同一 statement；新私有 GET。
- `apps/api/src/event-player-statistics-domain.test.ts`：28 条源码测试，含坏确认/白名单/数字/名单身份、TEAM_ONLY/pending/混合覆盖、重开重确认、零分样本、同名不合并/犯规不破同分、hash 对顺序及 asOf 稳定。
- `apps/api/test/c03-player-statistics.integration.test.ts`：7 条真实 PG HTTP 回归，覆盖无赛程、跨机构/匿名/单场工作人员与 event_staff 撤权、混合采集/未归属、重开更正确认、坏源及恢复、并发重开整条快照。复用合成夹具与独占锁支持，坏源窄更新在 finally 恢复。

实际运行：`npm run typecheck --workspace @small-city-basketball/api` 通过（包含新 PG 测试类型）；`npm run test --workspace @small-city-basketball/api` 全部 **307 / 22 文件通过**（其中新增 28）；`npm run build --workspace @small-city-basketball/api` 通过；七文件 Prettier 格式化完成；`git diff --check` 通过。首次 strict 揭示测试 support 的 Event 类型要求额外 permissions，已改为直接调用既有真实 staff HTTP，随后 strict 通过。

本机无 PostgreSQL/Docker，7 条真实 PG **未执行**，由 root 隔离 CI 验证，不能将编译或源码通过称作 PG 通过。真实浏览器也未由本实施者执行。新 controller/service 的 app.ts 注入与共享合同由 root 集成；root 已按 allowlist 复制这 7 个交付文件，源码冻结。无 Migration 编写或执行，无 Git commit/push，无生产变更。

下一步：root 集成生命周期与本模块后跑完整 strict/source/真实 PG/browser/恢复 CI；独立审查关注权限、来源 snapshot 及 sourceHash。若 CI 失败，保留该轮证据并只修实测问题。该模块 REVIEW，尚未 MAIN / DONE。
