# C19 交接：私有赛季与独立 PRIVATE_SEASON 数据授权（Agent 赛季）

2026-10-28 Asia/Shanghai；模块负责人 Agent 赛季（Claude Code）。状态：**本地分支完成，待集成人合入与复核**（LOCAL_ONLY，未 push）。

## 现场

- worktree `D:\Projects\scb-c19-seasons`，分支 `c19/seasons`，基线 `c19/teams` 的 `70f19c4`（含 Migration 020 绑定模型）。
- 本模块提交：`03608d4`（API、Migration 022、契约、单测、真实 PG 测试）、`c0d5dff`（小程序两页、utils、VM 测试、真实 API 页面回路），以及本交接文档提交。
- 未修改：`app.ts`、`request-body.ts`、契约索引、运行时权限清单、`api.js`、`app.json`、`ui.js`、Migration 001–021、球队模块文件（020、`team-membership-*`、`registration-service.ts`）。

## 实现摘要

| 部分 | 文件 |
|---|---|
| Migration | `apps/api/migrations/022_c19_private_seasons.sql`：`seasons`、`season_events`、`season_data_grants` + 三个守卫触发器（调用者权限，无 SECURITY DEFINER） |
| 契约 | `packages/contracts/private-seasons.d.ts` |
| 领域 | `apps/api/src/season-domain.ts`（输入校验、状态机、失效原因、聚合与 sourceHash、授权说明文本） |
| 服务/控制器 | `apps/api/src/season-service.ts`（`new SeasonService(pool, options)`，现继承 `ApplicationService`）、`season-controller.ts`（类名与 `SCB_SEASON_SERVICE` 不变） |
| 小程序 | `apps/wechat/utils/seasons.js`；`pages/seasons/*`（机构 OWNER/ADMIN）；`pages/season-grants/*`（`?orgId&eventId` 为主办方提名/撤回，无参数为球员本人授权与本人统计） |
| 测试 | `season-domain.test.ts`、`test/c19-private-seasons.integration.test.ts`、`apps/wechat/test/c19-seasons.test.cjs`、`tests/wechat-api/c19-seasons.test.mjs` |

路由与 C19 §5 冻结表一致（12 条，均已在小程序白名单内）。补充的请求/响应字段（均在模块契约文件内）：

- `POST /seasons` 请求体 `{clientRequestId(UUID v4), name, startDate, endDate}`；首次 201、同编号同内容重放 200、不同内容 409 `IDEMPOTENCY_CONFLICT`。
- `GET /seasons/:id` 返回 `SeasonDetailData`，附 `candidates`（本机构日期在范围内且未归入任何赛季的赛事，供显式归入；不是自动归属）。
- `GET /events/:eventId/season-data-grants` 返回 `EventSeasonGrantsData`：赛事、所属赛季、冻结名单来源（每名成员当前绑定账号的显示名）、本届授权记录、授权说明。冻结契约未单列“来源”接口，故并入此 GET。
- 提名 POST 首次 201、重放 200；`/commands` 与 `withdraw` 返回 200。

## 关键规则（对照用户要求）

**D1 独立授权**
- 用途固定 `PRIVATE_SEASON`（列 CHECK）。授权行精确记录 `org/event/team/member/target_user_id`，并记录**提名时看到的那一条绑定 `binding_id`**（复合外键到 `team_member_bindings(org_id,team_id,id)`；插入触发器要求该绑定 ACTIVE 且成员、账号一致）。
- 提名人：当前 OWNER/ADMIN 或该届 ACTIVE `EVENT_MANAGER`（`event_staff`）；机构角色 `EVENT_MANAGER` 本身不够。
- 状态：`PENDING → ACTIVE | DECLINED | WITHDRAWN`，`ACTIVE → REVOKED | WITHDRAWN`；终态不可再动（触发器 + 领域双重）。同意/拒绝/撤销只允许目标本人（他人 404），撤回为当前提名权人。
- 生效（进入聚合）在**每次读取的同一语句**中判定：状态 ACTIVE、那条 `binding_id` 仍 ACTIVE、提名人当前仍有提名权、来源成员仍在该届 `registration_freezes` 快照中、目标账号与机构 ACTIVE、赛事当前归入该赛季。任何一项失效，下一次读取即剔除，并在 DTO `ineffectiveReasons` 说明。
- 不复活：重新绑定产生新绑定行，旧授权仍指向已结束的绑定，永不再生效；终态授权不能再同意；重新提名是新行（部分唯一索引按 `(event_id, binding_id)` 限一条 PENDING/ACTIVE），须本人再次同意。
- 与 C07 互不替代：本模块不读写 `booking_performance_links`/`booking_profiles`；真实 PG 测试断言 C07 同意后 `season_data_grants` 为 0，赛季同意后 C07 行不变。账号绑定本身不产生任何授权行。
- 同意界面（`disclosure`）说明用途、范围、读者、统计口径（逐人确认得分/犯规；重开剔除；“名单场次”不代表出场；篮板/助攻/出场时间“未统计”）、撤销方式与独立性；页面要求先勾选“已阅读”再弹确认框。
- 幂等/CAS/审计：提名按 `(org, nominated_by, clientRequestId)` 唯一 + 事务级 advisory lock 串行；请求指纹 `sha256(JSON["v1","SEASON_GRANT_NOMINATE",eventId,规范化输入])`；所有状态变化 `expectedVersion` CAS；业务行与 `audit_logs` 同事务（`SEASON_GRANT_NOMINATED/CONSENTED/DECLINED/REVOKED/WITHDRAWN`），审计失败整体回滚。历史行只转终态，运行时无 DELETE（触发器亦拒绝 DELETE）。

**D2 赛季与统计**
- 赛季 `DRAFT → ACTIVE → CLOSED`，仅 OWNER/ADMIN（其他成员 403，非成员 404，匿名 401）。创建幂等；PATCH/命令均 CAS；`ATTACH_EVENT` 要求赛事日期完全落在赛季范围内、每赛事仅一个 ACTIVE 归属（部分唯一索引兜底并发）、每赛季上限 50 届；PATCH 不得把已归入赛事排除在范围外。
- CLOSED 锁定名称、日期、归属：API 409 `SEASON_CLOSED`，数据库触发器也拒绝改 CLOSED 行和其归属行。CLOSED 不影响撤销/撤回，也不冻结赛果：读取仍按当前有效来源计算（测试覆盖关闭后撤销、撤回、重开均改变结果/sourceHash）。
- 权限：机构榜单仅 OWNER/ADMIN；只管理某届的 EVENT_MANAGER 读赛季/榜单得 403；球员 `GET /me/season-statistics` 只返回本人行，且只披露其曾被提名的赛事；DRAFT 赛季对球员不可见；跨机构 404。
- 聚合：每届赛事执行与 `EventPlayerStatisticsService` 相同的证明查询，调用既有 `calculateEventPlayerStatistics`（内部即 `confirmedPlayerStatistics` 来源校验）；不新建比分事实，不缓存。只取有效授权对应 `(teamId, memberId)` 的行，按 `(event, entry, rosterRevision, member)` 去重，同机构按 `target_user_id` 汇总，不跨机构合并。某届来源无法核验时整届标 `INVALID` 不计入，绝不回退旧数据；未发布赛程 `NO_SCHEDULE`；日期后来越界 `OUT_OF_RANGE`。
- `sourceHash = sha256(算法版本, seasonId, seasonVersion, [各届 eventId+状态+该届 sourceHash], [有效授权 id+version+bindingId+来源+账号])`，覆盖赛季版本、赛事集合、授权和确认来源；`asOf` 不入哈希。
- 读取在单个 `REPEATABLE READ READ ONLY` 快照内完成（不加行锁，自写只读会话校验），确保数字与 sourceHash 描述同一数据库状态。
- `rebounds/assists/minutesPlayed` 恒为 `null`，页面显示“未统计”；`rosterSampleMatchCount` 页面称“名单场次（非实际出场）”；`rankingComplete=false` 时页面显示“部分样本……不是完整排名”，榜单注明“仅含已授权球员”。

## 与真实代码的冲突与处理

1. **球队接口未在本基线实现**（`team-membership-service.ts` 为骨架）。真实 PG 与真实 API 测试中的绑定由 SQL 夹具按 020 约束插入（`team_join_codes` + `team_member_bindings`，source=JOIN_CODE），文件内已标注“FIXTURE PREPARATION，不是球队流程验收”。合入 `c19/teams` 完成版后建议集成人把真实 API 回路改为经 `team-joins` 页面绑定再跑一次。
2. **冻结契约无“可提名来源”接口**：并入 `GET events/:eventId/season-data-grants` 的 `sources` 字段（见上）。
3. **复用统计计算**：`EventPlayerStatisticsService.snapshot` 是 `private`，不能从本服务调用且不得改其文件；本服务复制了同一条只读证明 SQL（`EVENT_PROOF`），计算与来源校验完全复用 `calculateEventPlayerStatistics`。若集成人希望消除重复，可把该查询抽为共享导出（需改 `event-player-statistics-service.ts`，非本模块文件）。
4. **“当前绑定失效”的判定**按简报解释并加强：要求的是**提名时那条绑定**仍 ACTIVE（而非“该成员当前有任意绑定”），这样重新绑定不能让旧的 ACTIVE 授权复活；需重新提名 + 再次同意。
5. **页面路由**：`ui.js` 的 `routes` 不含新页面（`ui.open` 会拒绝），本模块页面之间用 `wx.navigateTo` 直接跳转；VM 预览助手只渲染 `app.json` 已注册页面，故 `c19-seasons.test.cjs` 用临时目录拷贝并补注册后渲染（只在测试中，不改仓库 `app.json`）。

## 需要集成人修改的共享文件（原文）

1. `apps/wechat/app.json` `pages` 追加：
   ```
   "pages/seasons/index",
   "pages/season-grants/index"
   ```
2. `apps/wechat/utils/ui.js` `routes` 键列表追加 `'seasons'`、`'season-grants'`（用于 `ui.login` 的 `returnTo` 回跳与将来 `ui.open`；未加时登录后回到账号页而非原页）。
3. `apps/wechat/pages/account`（集成人页面）入口建议：
   - 机构 OWNER/ADMIN 分组：“私有赛季（机构内部统计）” → `/pages/seasons/index?orgId=<机构ID>`
   - 我的分组：“我的私有赛季授权” → `/pages/season-grants/index`（说明：主办方提名、本人同意后才计入，可随时撤销）
   - 建议在 `pages/org-event`（赛事负责人可见）加入口“私有赛季提名” → `/pages/season-grants/index?orgId=<机构ID>&eventId=<赛事ID>`；否则只管理某届的 EVENT_MANAGER 只能经赛季页（其无权打开）进入。
4. `packages/contracts/runtime-privileges.json` 新增（运行时无 DELETE）：
   ```json
   "season_data_grants": {
     "privileges": ["SELECT", "INSERT"],
     "updateColumns": ["status", "version", "consented_at", "declined_at", "revoked_at", "withdrawn_by", "withdrawn_at", "withdraw_reason", "updated_at"]
   },
   "season_events": {
     "privileges": ["SELECT", "INSERT"],
     "updateColumns": ["status", "detached_by", "detached_at"]
   },
   "seasons": {
     "privileges": ["SELECT", "INSERT"],
     "updateColumns": ["name", "start_date", "end_date", "status", "version", "activated_at", "closed_at", "updated_at"]
   }
   ```
   本服务还会对 `team_member_bindings`、`team_members`、`events`、`event_staff`、`organizations` 使用 `SELECT … FOR SHARE`（PostgreSQL 要求表上至少一列 UPDATE 权限）；`team_member_bindings` 的 UPDATE 列由球队模块申请，请确认合并后存在。只读 `registration_freezes`、`schedule_*`、`published_matches`、`scoring_*`、`result_confirmations`、`entry_roster_players`、`knockout_round_publications`、`group_*` 均为既有 SELECT。
5. 表数/Migration 数：新增 3 表、Migration 022；c02/p07/readiness/backup/restore 计数由集成人统一更新（见下“已知失败”）。
6. `app.ts`、`request-body.ts`、`api.js` 白名单：**无需修改**（构造方式、路由前缀与 100kb 普通请求体均适用）。

## 已执行命令与结果（本机 Windows，隔离 PG 18 @127.0.0.1:55433）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `cd apps/api && npx vitest run src/season-domain.test.ts` | 14/14 通过 |
| `cd apps/api && npx vitest run src` | 554 项：550 通过，4 失败均为既有 `account-maintenance.test.ts` POSIX 基线 |
| `cd apps/api && TEST_DATABASE_URL=… npx vitest run test/c19-private-seasons.integration.test.ts` | 10/10 通过 |
| `… test/c19-team-membership … c03-player-statistics … player-performance …` | 均通过（与本模块同批运行） |
| `… test/c02-upgrade.integration.test.ts` | 3 失败：表数 74≠66、Migration 数 20≠18、升级列表多出 020/022 —— 预期，待集成人更新计数 |
| `… test/p07-runtime / p07-quarantine` | 失败/跳过：需预置角色的生产检查控制库（既有环境前提，非本模块） |
| `node --test apps/wechat/test/c19-seasons.test.cjs` | 17/17 通过 |
| `node --test apps/wechat/test/*.test.cjs` | 551 项：547 通过，4 失败均为既有 Windows 基线（夹具反斜杠 2、公开媒体夹具 1、symlink EPERM 1） |
| `npm run build --workspace @small-city-basketball/api` + `TEST_DATABASE_URL=… node --test --test-concurrency=1 tests/wechat-api/c19-seasons.test.mjs` | 1/1 通过（真实页面代码 → 真实 API → 隔离 PG） |
| `npx prettier --check --end-of-line auto <本模块 ts/js/mjs/cjs/d.ts>` | 通过（wxss 与仓库既有紧凑写法一致，Prettier 不处理 wxml） |
| `git diff --check` | 通过 |

真实 PG 覆盖：仅绑定/仅提名/仅预约档案（含 C07 已同意）均不聚合；同意后绑定结束 → 下次读取剔除；重新绑定不复活 REVOKED 与 ACTIVE 旧授权，新提名需新同意且只计一次；比赛重开即剔除、重确认只计当前一次；提名人失去 EVENT_MANAGER → 剔除（恢复后同一已同意授权恢复计入，不伪造新同意）；EVENT_MANAGER 读赛季 403；跨机构 404 且不合并；sourceHash 随赛季版本、赛事集合、授权、确认来源变化且同状态稳定；CLOSED 阻止编辑/归入/移出（API + 触发器），撤销与撤回仍生效；同 clientRequestId 4 路并发只建 1 行 1 条审计；不同编号并发同来源只 1 条 201；CAS 冲突；非本人回应 404；登出后 401；审计失败回滚（创建、命令、提名、同意）。

真实 API 页面回路：管理员在 `pages/seasons` 创建 → 显式归入 → 激活（榜单空）→ 从赛事入口进入 `pages/season-grants` 提名已绑定成员（DB 为 PENDING，榜单仍空）→ 球员页看到范围/读者/口径/撤销说明，勾选并同意（DB ACTIVE v2）→ 本人统计 5 分 1 犯规、篮板/助攻/出场时间“未统计” → 机构榜单出现该球员（无邮箱外泄）→ 球员撤销 → 本人统计与机构榜单均不再含该数据（DB REVOKED v3），审计序列完整 → 换账号后页面清空私有数据。

## 未执行

- 未在微信开发者工具、真机运行；未截图（`SCB_WECHAT_API_SNAPSHOTS` 未设置）。
- 未跑全量 `test:integration`（只跑了上表文件）；未跑 Playwright/管理端。
- 未与 `c19/teams` 完成版的真实加入/认领接口联调（绑定为 SQL 夹具）。
- 未 push、未建 PR、未执行任何生产 Migration。

## 审查关注点与风险

- **权限**：`GET events/:eventId/season-data-grants` 向该届提名权人展示冻结名单成员当前绑定账号的显示名（不含邮箱）；若认为对 EVENT_MANAGER 过多，可收窄为仅 OWNER/ADMIN 可见绑定名。
- **提名权恢复**：提名人失去权限后剔除；若权限恢复，同一已同意授权重新计入（本人同意仍有效、未被撤销）。若产品要求“失权即永久失效”，需改为读取时检测并转终态（需写路径）。
- **数据库**：守卫触发器为 invoker；`season_data_grants` 插入触发器读取 `team_member_bindings`（运行时已有 SELECT）。CLOSED 守卫在 `season_events` 上查询 `seasons`。
- **并发**：赛季命令锁顺序 会话→机构→赛事(FOR SHARE)→赛季(FOR UPDATE)；PATCH 先 FOR SHARE 已归入赛事再锁赛季并 CAS；两个赛季抢同一赛事由部分唯一索引兜底（23505 → 409）。提名在锁事件与校验权限之后才查回执，403 不泄露回执是否存在。
- **读取一致性**：统计读取在 RR 只读快照中，不持有行锁；会话校验也在快照内完成（与写路径的 `lockActor` 语义一致但不加锁）。
- **性能**：每次读取对每届赛事执行一次证明查询（上限 50 届、每届 ≤32 队），首版不缓存；大赛季读取成本线性增长。
- **恢复**：创建/提名的原请求编号只保存在页面内存（未知结果时锁定输入并提供“核对并重试”沿用原编号）；页面卸载或换账号即丢弃，此时须刷新列表核对，未做持久化存储恢复。

## Codex 接续修复（2026-10-28 Asia/Shanghai）

本节订正上文历史限制；当前负责人 Codex 赛季模块，基线 `2be4b86`，独立 worktree `/workspace/scratch/608836f8d204/scb-c19-seasons-resume`，分支 `codex/c19-seasons-resume`。主集成人仍单写共享文件与总任务记录。

- 修复“提名权恢复即复活旧授权”：022 增加不可逆 `invalidated_at` / `invalidation_reason`。绑定结束、机构/账号停用或提名人确实失去最后一项提名权时，在原变更事务里由 invoker 触发器登记；即使停用与恢复发生在两次读取之间，旧授权也不再生效。保留原同意历史，不伪造撤回人。有效来源唯一索引排除已失效行，因此恢复后须新提名、新同意。恢复一条权限并不清除失效证据；仍保留其他提名权时不会误失效。
- 本人同意先锁绑定、后锁授权，和绑定结束触发器采用同序，避免互锁；提名锁住目标账号，防止停用与插入之间漏记失效。
- 新页面的确认现在固定目标快照、版本与能力；生成编号在已绑定的确认操作内进行，生成后、发送前再次检查。创建、保存、赛季命令、提名、同意/拒绝/撤销、撤回均对实际发送前失效做零请求守卫。
- 创建赛季与提名的原编号及原请求体持久化在本账号、本机构/赛事专属存储键中；页面卸载后可恢复，账号切换不使用其他账号记录。保存/读回失败不发送，不覆盖未核对请求；网络与 5xx 结果保留原编号。取代上文“仅存在内存”的限制。
- `GET /v1/me/season-data-grants` 增加 `limit`（默认/最大 50）与 `cursor`，响应增加 `nextCursor`。游标保留 PG 微秒级时间与 UUID；所有页仍按当前账号过滤。球员页可读取更早授权并撤销，后页失败保留已读部分，刷新会使旧分页回调失效。
- 刷新资料失败清除旧私有榜单/授权资料；换账号同时清理当前统计定位。
- 真实 API 页面测试改为领队页发起精确历史成员认领、球员加入页本人接受，再进行赛季提名/同意/统计/撤销。删除 SQL 绑定夹具。普通加入创建新成员，不能冒充冻结旧名单成员；普通加入另由球队真实页面流程覆盖。

共享集成要求：`season_data_grants` 运行时 UPDATE 列追加 `invalidated_at`、`invalidation_reason`；小程序自身授权列表白名单允许上述有界 `limit/cursor`。DTO 增加可选 `invalidatedAt`、`invalidationReason`，未新增表。022 为未发布迁移，修订 checksum；001–018 未修改。

本轮已执行：类型检查通过；赛季领域单测 15/15；赛季页面回归 39/39（其中分页两项测试临时使用集成人已修改的真实 `api.js` 白名单，测试后还原，不将共享文件混入模块提交）；格式与 `git diff --check` 通过。新增 22 项页面回归断言实际写请求与原编号，并覆盖 UUID 等待、目标变化、跨页面恢复、存储失败及刷新/分页竞争。

真实 PG 测试现为 13 项，增加不可逆失效矩阵、绑定结束/同意竞争及旧授权分页撤销。当前容器缺少可运行的非 root PostgreSQL 通道，未执行这些新 PG 测试；历史 Windows 结果不作本轮证据。修改后的真实 API 认领到赛季流程也须在完整集成候选 + 真实 PostgreSQL 执行。未运行微信工具、真机、截图、生产 Migration；未 push 或修改 PR。

- 独立复核再修正无样本伪排名：仅在当前有效逐人来源且名单样本数大于 0 时生成球员行。重开、未发布、来源无效不会生成“0 分第 1 名”；确有已确认样本的零得分仍显示 0。领域和真实 PG 重开断言同步加强。
