# C02 逐人基础统计后端交接

2026-10-23（Asia/Shanghai）；负责人：`stats_contract`（Codex）；状态：REVIEW / LOCAL_ONLY，尚未经过真实PG验收。

## 实际现场与修改范围

- worktree：`/workspace/scratch/dc6a786e1a31/c02-stats`，分支 `feat/C02-stats`；基线 `153421668ea74378df859a4b7c21df7da11ad77e`。
- 修改：`packages/contracts/index.d.ts`、`apps/api/src/scoring-domain.ts`、`apps/api/src/scoring-service.ts`。
- 新增：`apps/api/src/player-statistics.ts` 及8项域测试、`apps/api/migrations/008_p05_player_statistics.sql`、7项真实PG用例 `apps/api/test/p05c-player-statistics.integration.test.ts`。
- 没有修改原001–007、公开/OBS字段、身份/保险资料、生产数据库或正式账号。没有commit/push/部署。root独占runtime权限manifest、迁移清单/指纹及CI编排。

## 已实现

1. 复用published_matches固定的双侧名单revision，私有Workbench只取memberId/name/jerseyNo；不新增比赛名单表，不使用长期成员当前姓名覆盖旧名单。
2. PREPARE可选择TEAM_ONLY或PLAYER_BASIC，缺省保持旧模式；模式记录在原准备事件并由SQL state guard锁定。旧命令未传新字段时不补null/default，旧规范哈希保持兼容。
3. 原RECORD_STAT/ADD_CORRECTION/REPLACE_STAT新增可选nullable memberId，只允许得分/犯规且须属于该侧冻结名单。未归属总数显式保留；暂停不归属球员。更换队伍的替换命令须明确新归属或null，撤销/替换沿原事件历史。
4. 同一事务从原activeStats重放球队及个人投影；持久化在原scoring_states，并在原result_confirmations追加个人确认快照。确认前和读快照时校验投影，FINAL有效确认还须与个人投影一致；重开保留旧确认。
5. 历史确认个人JSON经白名单复制、UUID规范化/重复检查及计数/名单字段检查，避免新增JSON透传面。TEAM_ONLY的个人统计为null、高级数据未伪造0。
6. 私有Workbench沿原实际赛事staff/场次工作人员授权；registration原已向实际赛事staff开放同样例行名单字段，没有开放新的匿名或OBS名单读取。球员公开发布留待另卡显式opt-in。

## 冻结私有DTO

- Workbench：`playerRoster: {home: EntryRosterPlayer[], away: EntryRosterPlayer[]}`。
- Snapshot/Confirmation：`playerStatistics: MatchPlayerStatistics | null`。
- MatchPlayerStatistics：`{mode:'PLAYER_BASIC',home:{players:[{memberId,name,jerseyNo,score,fouls}],unassigned:{score,fouls}},away:同}`。
- `collected.playerStatistics`改为boolean，仅表示本批基础分/犯规；公开原DTO不变。

## 验证与剩余门槛

- API strict：`node node_modules/typescript/bin/tsc --noEmit --project apps/api/tsconfig.json`，通过，包含新PG用例的类型检查。
- API源码：在apps/api执行 `node ../../node_modules/vitest/vitest.mjs run src`，20文件 / 268测试通过，其中新域测试8项。格式检查、`git diff --check`通过。
- 静态独立复核吸收：最终确认一致性、JSON白名单、UUID大小写重复和姓名长度检查。静态复核不等于真实PG执行。
- 7项PG用例已编写：原子与幂等、错误归属回滚无receipt、撤销/替换、独立确认与重开历史、TEAM_ONLY兼容、跨机构及模式不可改、坏个人投影拒读拒写。**本地无可用PostgreSQL/Docker，尚未执行；008仅已编写，未执行。**
- UI由独立stats_ui负责人实现，本分支不包含其验收结论。浏览器、真实PG、生产模式HTTPS与真实OBS均不能凭本交接称通过。

## root下一条操作

整合本分支明确文件与stats_ui改动；runtime-privileges给scoring_states的UPDATE列白名单追加`player_stats`（collection_mode只需INSERT，不给UPDATE），同步新增迁移与现有40表完整指纹/恢复清单。运行整合源码/类型/build与真实隔离PG，再执行桌面/手机及生产模式HTTPS回归。未补齐PG与浏览器证据前不要标为DONE或发布生产。
