# C19 交接：申请建队 / 加入 / 成员绑定（Agent 球队）

分支 `c19/teams`（基于集成提交 2eac213），worktree `D:\Projects\scb-c19-teams`。状态：模块实现完成、本地验证通过，待集成人合入共享文件后整体验收（LOCAL_ONLY，未推送）。Migration 020：**已编写**，仅在本任务隔离 PG（127.0.0.1:55433 下测试工具自建子库/控制库 `scb_test_c19_teams`）**已执行**，未在任何正式环境执行。

## 给 Agent 赛季：绑定表与“我的成员关系”（已稳定）

表 `team_member_bindings`（Migration `020_c19_team_membership.sql`）：

| 列                                         | 含义                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `id uuid`                                  | 绑定编号（`bindingId`）                                                                                   |
| `org_id, team_id, member_id`               | 复合外键 `(org_id, team_id, member_id) → team_members(org_id, team_id, id)`，保证机构、球队、成员归属一致 |
| `user_id`                                  | 绑定的账号                                                                                                |
| `source`                                   | `JOIN_CODE`（加入码，新建成员）或 `CLAIM`（领队定向认领历史成员）                                         |
| `join_code_id` / `claim_id`                | 来源（与 `source` 二选一）                                                                                |
| `status`                                   | `ACTIVE` → `ENDED`（只此一个方向；结束后不可恢复，触发器保证）                                            |
| `ended_reason`                             | `LEFT`（本人退出）、`REMOVED`（领队移除）、`MEMBER_REMOVED`（长期名单保存时该成员被移出）                 |
| `ended_by, end_note, created_at, ended_at` | 历史                                                                                                      |

语义：

- **“目标账号当前对该长期成员有有效绑定”** = 存在行 `status='ACTIVE' AND user_id=:target AND org_id=:org AND team_id=:team AND member_id=:member`。
- 部分唯一索引：同一 `(org_id, team_id, user_id)` 至多一个 ACTIVE；同一 `member_id` 至多一个 ACTIVE。
- 触发器：成员一旦绑定过账号 A，就不能再插入指向其他账号的绑定（不静默转交）；ENDED 行不可改写。
- 重新加入/重新认领插入**新行**，旧行保持 ENDED，赛季授权检查应按当前 ACTIVE 行判断，不复活旧授权。
- 普通球员绑定**不写** `team_access_grants`，也**不进入**会话 `teamContexts`。

`GET /v1/me/memberships` 返回 `MembershipData[]`（`packages/contracts/team-membership.d.ts`）：
`{bindingId, orgId, organizationName, teamId, teamName, memberId, memberName, source, status:'ACTIVE'|'ENDED', endedReason, createdAt, endedAt}`；ACTIVE 在前，含历史（最多 100 条）。只含本人记录。

## 实现摘要

| 部分              | 文件                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Migration         | `apps/api/migrations/020_c19_team_membership.sql`（5 张新表 + 绑定守护触发器，invoker 权限）                                              |
| 契约              | `packages/contracts/team-membership.d.ts`                                                                                                 |
| 领域/服务/控制器  | `apps/api/src/team-membership-{domain,service,controller}.ts`，单测 `team-membership-domain.test.ts`                                      |
| 成员保存修复      | `apps/api/src/registration-service.ts#updateTeamMembers`                                                                                  |
| 真实 PG           | `apps/api/test/c19-team-membership.integration.test.ts`                                                                                   |
| 小程序            | `pages/team-request`、`pages/team-requests`、`pages/team-join`、`pages/memberships`（新），`pages/team`（改），`utils/team-membership.js` |
| 小程序 VM         | `apps/wechat/test/c19-team-membership.test.cjs`                                                                                           |
| 真实 API 页面闭环 | `tests/wechat-api/c19-teams.test.mjs`                                                                                                     |

提交：`722bd70`（成员保存修复 + 回归）、`70f19c4`（Migration 020 + 契约，早期提交供赛季）、`c244450`（API + 真实 PG）、`126dc18`（小程序页面 + VM）、`b77a485`（真实 API 页面闭环）、本交接提交。

## 关键规则（按用户要求逐条落地）

申请建队（C1）：

- 只有机构 OWNER/ADMIN 生成/撤销分享入口（非成员 404、普通成员 403）；令牌 128 位（base64url 22 字符），只存 SHA-256；1–168 小时、1–200 次、撤销需 4–500 字原因。
- `resolve` 只返回 `{linkId, orgName, expiresAt}`；提交不接受 orgId 字段（多余字段 422）；无机构搜索。
- 提交按 `(requester_id, client_request_id)` 唯一约束持久去重：首次 201、同编号同内容 200（返回原申请，不再消耗入口次数，入口已满/撤销也能恢复）、同编号不同内容 409 `IDEMPOTENCY_CONFLICT`；并发重复在唯一冲突后回滚并以新事务读回。
- 每人每机构至多 3 份 PENDING（防刷，按 (机构, 申请人) 咨询锁串行计数）；同一入口每人至多一份未撤回申请、累计 3 份（审查修复 P3-2/P3-4）。
- 申请人只能读/撤回自己的（他人 404）；撤回 CAS。
- 审核：仅目标机构当前 OWNER/ADMIN；审核人=申请人 403 `REVIEWER_IS_REQUESTER`（DB CHECK 兜底）；CAS 409；原因 4–500；已处理 409 `TEAM_REQUEST_CLOSED`。
- 批准同一事务：插入 `teams` + `team_access_grants(TEAM_MANAGER)` + 申请 APPROVED/`team_id` + 审计（`TEAM_CREATED`、`TEAM_REQUEST_APPROVED`）；`UNIQUE(team_id)` 与状态 CAS 保证最多一支队；不写机构成员或赛事工作人员。审计失败整体回滚（已测）。
- 未批准没有球队，自然无法报名；批准后报名沿用既有领队/审核分权与冻结规则（未改动报名代码）。

加入与认领（C2）：

- 加入码 128 位、Base32 26 字符、只存 SHA-256；默认 168 小时/30 次（上限亦为 30 次、168 小时）；可撤销；使用时检查机构 ACTIVE、球队存在、签发者仍为 OWNER/ADMIN 或有效 TEAM_MANAGER（否则列表显示 `ISSUER_INVALID`，使用失败）。
- 失败限流：`JOIN_CODE_INVALID`/`JOIN_CODE_PREDATES_REMOVAL`（入口为 `TEAM_REQUEST_LINK_INVALID`）按账号与可信 IP（Express `trust proxy` 解析的 `req.ip`）各计，每分钟 10 次，复用 `auth_rate_limits`；超限后连有效码也 429。
- 正常加入：新建 `team_members` 行 + 本人绑定，不按姓名匹配；已有有效绑定则直接返回原绑定（200），不计次；计次用条件 `UPDATE … WHERE use_count<max_uses`，且所有绑定写入先 `FOR UPDATE` 锁球队行，串行化加入/认领/退出/移除/成员保存。
- 被移除/退出者：码 `created_at <= 该账号在该队最近一次绑定结束时间` 即 422 `JOIN_CODE_PREDATES_REMOVAL`，需新码。
- 认领：领队按精确 `memberId` + 目标 `userId` 定向发起（沿用“目标账号编号”的明确账号邀请方式），7 天有效，单次；目标本人在“加入球队”页核对接受/拒绝；成员已有有效绑定 409 `MEMBER_ALREADY_BOUND`；成员曾绑定过其他账号 409 `MEMBER_BOUND_TO_OTHER_ACCOUNT`（触发器兜底，禁止静默转交）；目标已是本队成员 409；同成员同时只一份待接受认领。不按姓名/邮箱推断。
- 移除（领队）/退出（本人）：绑定 ENDED（`REMOVED`/`LEFT`）+ 该成员移出长期名单（ARCHIVED）+ 撤销其待接受认领 + 球队 `version+1` + 审计；历史保留；冻结报名快照不受影响（只引用成员 id）。
- 领队视图只含成员名、绑定账号 `display_name`、状态、来源与时间；不含邮箱、账号 id、联系方式或其他球队身份（已测 JSON 不含 `@example.test`/`userId`）。
- 普通球员绑定不写 `team_access_grants`、不进入会话 `teamContexts`（API 与真实页面闭环均断言）。

成员保存修复：原逻辑“全队 ARCHIVED → 再恢复保留项”。现改为只归档实际移出的 ACTIVE 成员；保留且未改名的行完全不写；改名只更新名字；被移出成员的有效绑定同事务 ENDED(`MEMBER_REMOVED`)，其待接受认领撤销。回归测试用作用域触发器记录状态转换：在 2eac213 上失败（保留成员出现 ACTIVE→ARCHIVED→ACTIVE），修复后通过；失败输出存于会话 scratchpad `c19-teams-prefix-fail.txt`。加入/移除/退出都会 `version+1`，所以基于旧版本的成员保存会 409，不会把刚加入的球员静默归档（已测）。

## 与冻结契约/真实代码的差异（请集成人记录）

1. 契约 §1 列出的 `team_operations` 表**未创建**：请求幂等由 `team_requests` 唯一约束承担，历史由各表终态行 + `audit_logs` 承担，没有需要它的场景。新表为 5 张：`team_request_links`、`team_requests`、`team_join_codes`、`team_member_claims`、`team_member_bindings`。
2. `POST /v1/team-joins` 返回 `MembershipData`，首次 201、重复 200；`POST /v1/team-requests` 首次 201、重放 200。
3. `POST /v1/me/member-claims/:id/accept|decline` 返回 `{claim: MyMemberClaimData, membership: MembershipData|null}`；重复同一决定返回原结果。
4. `GET member-bindings` 返回 `TeamMemberBindingsData`（含 `claims` 与可认领成员 `claimableMembers`），供领队撤销认领与选择成员，契约无单独的认领列表接口。
5. （已记录决定，集成人接受）`remove` 与 `leave` 同时把成员移出长期名单（“移除/退出球队”语义）；若仅需解绑而保留成员，需领队之后在长期名单里另行处理（当前 UI 不提供恢复已归档成员）。
6. 新增约束：每人每机构 PENDING 申请 ≤3；球队 ACTIVE 长期成员 ≤60 时加入返回 422 `TEAM_FULL`（与既有名单上限一致）。
7. `TeamMembershipService` 改为继承 `ApplicationService`（构造签名不变，`app.ts` 无需改动）。

## 需要集成人修改的共享文件（精确内容）

1. `apps/wechat/app.json` `pages` 追加：`"pages/team-request/index"`、`"pages/team-requests/index"`、`"pages/team-join/index"`、`"pages/memberships/index"`。
2. `packages/contracts/runtime-privileges.json` 新增：

```json
"team_join_codes": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["use_count", "revoked_at", "revoked_by"] },
"team_member_bindings": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["status", "ended_reason", "ended_by", "end_note", "ended_at"] },
"team_member_claims": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["status", "decided_at"] },
"team_request_links": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["use_count", "revoked_at", "revoked_by", "revoke_reason"] },
"team_requests": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["status", "version", "reviewer_id", "review_reason", "reviewed_at", "withdrawn_at", "team_id", "updated_at"] }
```

无 DELETE。既有表沿用现有授权（`teams`/`team_members`/`team_access_grants` INSERT 与列更新、`auth_rate_limits`）。触发器函数 `c19_guard_member_binding()` 为默认 invoker。3. 表数 +5、Migration +1（020）：readiness、privileges、backup/restore、c02-upgrade/p07 计数。4. （建议）`apps/wechat/utils/ui.js` 的 `routes` 增加 `team-request`、`team-requests`、`team-join`、`memberships`，使登录回跳可回到这些页；本模块页面自身用 `utils/team-membership.js#go` 导航，不依赖此项。5. `apps/wechat/pages/account` 入口文案（集成人添加）：所有登录用户“加入球队 / 认领” → `/pages/team-join/index`；“我的成员关系” → `/pages/memberships/index`；“我的建队申请” → `/pages/team-request/index`（无令牌时只看我的申请）；机构 OWNER/ADMIN “建队申请审核” → `/pages/team-requests/index?orgId=<机构>`。6. `apps/wechat/utils/api.js` 白名单无需修改（已覆盖全部路由，VM 测试逐条断言）。

## 审查修复（独立审查，无 P0/P1）

提交：`667184e`（Migration 020 原地修订：P3-5 状态机守护 + P3-7 索引）、`dba9b69`（服务修复 P2-1、P3-2…P3-6 + 真实 PG 回归）。020 尚未在任何集成环境执行，按集成人要求原地修改、不新增编号；本机控制库已按旧校验和执行过 020，因此复验改用本任务新建的隔离库 `scb_test_c19_teams_r2`（同一 PG 集群，本任务创建，可删除）。

| 编号 | 问题                                  | 修复                                                                                                                                                                                                                                                             | 回归测试（修复前失败原因）                                                                                                                                   |
| ---- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 | 移除前发出的认领可让被移除者重新入队  | 领队移除、本人退出、长期名单保存移出成员时，同事务撤销该队所有发给该账号的 PENDING 认领（不只撤销针对该成员的）；接受认领时若 `claim.created_at <=` 该账号在该队最近一次绑定结束时间，返回 422 `CLAIM_PREDATES_REMOVAL`（检查先于签发者资格检查）                | `P2-1 …`：修复前认领仍为 PENDING（`expected 'PENDING' to be 'REVOKED'`）；另以直接插入的“移除前创建”认领验证纵深防御，并覆盖长期名单保存路径                 |
| P3-2 | 同一持有人可提交/撤回循环耗尽共享入口 | 同一 (入口, 申请人) 至多一份未撤回申请（409 `TEAM_REQUEST_LINK_ALREADY_USED`），含已撤回的累计至多 3 份（409 `TEAM_REQUEST_LINK_SUBMISSION_LIMIT`）；原编号重放不受影响                                                                                          | `P3-2 …`：修复前第二份直接 201                                                                                                                               |
| P3-3 | 失败限流可被并发突发绕过              | 每次尝试先原子占用名额（`rateLimit` 先自增，超过 10 即 429），成功或非计数错误后退还（`attempts>1` 减一，最后一个名额删除行，满足 `attempts>0` 约束）；计数失败不退还                                                                                            | `P3-3 …`：20 个并发错误码，修复前 11 个进入业务逻辑；另验证 15 次成功解析不被限流                                                                            |
| P3-4 | 两个入口并发可突破每机构 3 份 PENDING | 计数前对 `(org, requester)` 取 `pg_advisory_xact_lock`（位于机构锁与入口行锁之后，同一申请人跨入口串行）                                                                                                                                                         | `P3-4 …`：5 个入口并发，修复前 5 份全部成功                                                                                                                  |
| P3-5 | 运行时列授权下可回退其他表状态        | 四张表 BEFORE UPDATE 守护（invoker）：身份列不可变；申请只允许 PENDING → 终态一次且 version+1（`team_id` 因此只写一次）；认领只决定一次；加入码/入口 `use_count` 只能 +1 且仅在未撤销时；撤销字段只能 NULL→值一次。五张表禁止 DELETE/TRUNCATE（与 C18 先例一致） | `P3-5 …`：直接 UPDATE（APPROVED→PENDING、换 team_id、减 use_count、取消撤销、改有效期、重开认领）与 DELETE/TRUNCATE 均在事务内执行并回滚；修复前 UPDATE 成功 |
| P3-6 | 签发者恢复权限后旧码/旧认领复活       | 采用 created_at 谓词（不改其他模块）：签发者须有 ACTIVE 且 `updated_at <=` 码/认领 `created_at` 的 TEAM_MANAGER 授权，或同样条件的 OWNER/ADMIN 机构成员身份；列表显示 `ISSUER_INVALID`                                                                           | `P3-6 …`：停用再恢复领队授权后，修复前旧码仍为 ACTIVE；同时验证旧认领 `CLAIM_INVALID`、恢复后新签发的码可用                                                  |
| P3-7 | 绑定历史查询缺索引                    | `team_member_bindings(member_id, user_id)` 索引                                                                                                                                                                                                                  | `P3-7 …`：修复前索引不存在                                                                                                                                   |

已记录决定：本人退出与领队移除同时把长期成员移出名单（ARCHIVED），集成人已接受，保持现状。

P3-6 的保守副作用：对同一签发者授权行或机构成员行的任何重写（包括 ACTIVE→ACTIVE 的重复设置、角色调整）都会使其此前签发的加入码与待接受认领失效，需重新签发。

运行时权限：无新增需求。`auth_rate_limits` 的退还使用现有 `DELETE` 与 `attempts` 列更新权限；新触发器函数均为默认 invoker。

审查修复后复验（本机，隔离库 `scb_test_c19_teams_r2`）：

| 命令                                                                                                                                       | 结果                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 修复前 `npx vitest run test/c19-team-membership.integration.test.ts`                                                                       | 18 项：11 通过，7 项新回归全部失败（原因见上表；输出存于会话 scratchpad `c19-review-prefix.txt`） |
| `npx vitest run test/c19-team-membership.integration.test.ts src/team-membership-domain.test.ts test/p03-registration.integration.test.ts` | 3 文件 48/48 通过（c19 真实 PG 18、领域 6、p03 24）；c19 文件再单独运行一次 18/18                 |
| `node --test apps/wechat/test/c19-team-membership.test.cjs`                                                                                | 11/11                                                                                             |
| `npm run build --workspace @small-city-basketball/api` + `node --test --test-concurrency=1 tests/wechat-api/c19-teams.test.mjs`            | 1/1                                                                                               |
| `npm run typecheck`、`npx prettier --check`（本模块 TS 文件）、`git diff --check`                                                          | 通过                                                                                              |

## 已执行的检查（本机 Windows，隔离 PG 18 @127.0.0.1:55433）

| 命令                                                                                                                            | 结果                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 修复前：`TEST_DATABASE_URL=… npx vitest run test/c19-team-membership.integration.test.ts`（仅回归用例，2eac213 代码）           | 1 失败（预期，证明缺陷）                                                                                                                                                                                                                                                      |
| `npx vitest run test/c19-team-membership.integration.test.ts src/team-membership-domain.test.ts`                                | 2 文件 17/17 通过（真实 PG 11 + 领域 6）                                                                                                                                                                                                                                      |
| `npx vitest run test/p03-registration.integration.test.ts`（修复后）                                                            | 24/24 通过                                                                                                                                                                                                                                                                    |
| `npx vitest run src`（API 单测）                                                                                                | 546：542 通过，4 失败均为已知 Windows `account-maintenance` 基线                                                                                                                                                                                                              |
| `npx vitest run test`（过滤串也匹配 `src/*.test.ts`，即单测+全部真实 PG）                                                       | 69 文件 872 项：849 通过、11 跳过、12 失败——全部为预期：`account-maintenance` 4（Windows 基线）；`c02-upgrade` 3（迁移数 19≠18、表数 71≠66、迁移清单 12≠11，因新增 020，待集成人更新计数）；`p07-*` 5（需预置角色的生产检查控制库，本环境未提供）。其余含 p03、c18 等全部通过 |
| `node --test apps/wechat/test/*.test.cjs`                                                                                       | 545：541 通过，4 失败均为已知 Windows 基线（fulfillment/booking 夹具路径 2、public media 1、symlink EPERM 1）；含本模块 11/11                                                                                                                                                 |
| `npm run build --workspace @small-city-basketball/api` + `node --test --test-concurrency=1 tests/wechat-api/c19-teams.test.mjs` | 1/1 通过（真实页面 → 真实 API → 隔离 PG）                                                                                                                                                                                                                                     |
| `npm run typecheck`、`npx prettier --check`（本模块文件）、`git diff --check`                                                   | 通过                                                                                                                                                                                                                                                                          |

## 未执行

- 微信开发者工具/真机未运行；页面未在 `app.json` 注册前无法在 DevTools 打开。
- 其他 `tests/wechat-api/*.test.mjs`（既有模块）未在本分支重跑（未改动其页面，`pages/team` 的改动由 VM 全量测试覆盖）。
- 未推送、未建 PR、未部署、未在正式库执行 Migration。

## 风险与审查重点

- 权限：领队管理判断 = 机构 OWNER/ADMIN 或有效 TEAM_MANAGER；加入码/认领在使用时复核签发者权限。审核人≠申请人有服务层与 DB CHECK 双重保证。
- 并发：所有绑定写入先锁球队行（`FOR UPDATE`），加入计次另有条件更新；申请重复由唯一约束 + 新事务读回；两名管理员同时批准只有一个成功（已测）。
- 恢复：申请提交前把原请求编号写入本机存储（不含令牌），存储失败不发送；回复丢失后以原编号重发或从“我的申请”按编号找回；加入码天然幂等。
- 移除/退出会归档成员并使球队版本 +1：正在编辑长期名单的领队会遇到 409，需刷新（已在页面提示）。
- 失败限流只计失败；成功请求不受限，令牌/加入码 128 位熵。

## 2026-10-28 Codex 接续审查修复（BRANCH_ONLY）

用户推送中断成果后要求继续测试开发。集成人为本轮 Codex root；本模块独立检出 `/workspace/scratch/608836f8d204/scb-c19-identity-review`，分支 `codex/c19-identity-review`，基线 `72a51bd06d2b97752f2d69a089f22886e3bf669d`，开工工作区干净，origin 已核对。仅认领球队/关注业务与对应测试、交接；共享接线、权限清单、集成和最终 CI 由集成人负责。

新增修复：

- 申请生成 UUID 前固定会话、页面、入口和账号，准备失效后不弹出新确认、不写本机待处理记录、不发请求；退出后的空入口也不再触发未处理异常。
- 申请恢复记录不被另一个请求覆盖，迟到清理只允许删除原编号。共享写助手分别报告“是否已发送”和“是否已确定结果”，不从新账号页面的 `uncertain` 状态推断旧请求结果；已经发送后换账号，保留原账号的待核对编号。
- 新球队入口统一在确认后、重新读取会话后核对当时的账号与目标。审核/撤回检查版本、状态与权限；认领/退出/移除检查目标状态；球队管理同时检查球队版本与管理权限。
- 建队申请按 `(requester, clientRequestId)` 在首次回执查询前取得事务咨询锁。并发重试等待原请求提交后读取其结果，不因原请求耗尽入口最后一次使用而误报失效。
- 失败限流的成功退款原先“2 减至 1，再删除 1”会擦除已有一次失败。现对账号/IP 两个计数原子预留，退款锁定同一精确时间窗口，只释放自己的一个名额；旧窗口不会误减新窗口。
- 加入码/认领的签发时间比较在 PostgreSQL 中完成，避免转换成 JS Date 丢失微秒后把刚刚签发的有效授权误判为旧授权。

本轮实际证据（Linux/Node 24）：

- 球队+关注定向 VM：48/48；把本轮测试放回 `72a51bd` 源码后为 36 通过、12 失败（10 个球队新增回归、2 个关注新增回归全部失败）。断言实际请求、原请求编号和存储，不仅检查提示。
- 全量 `node --test apps/wechat/test/*.test.cjs tests/wechat-tools/devtools-ui.test.mjs`：605 项，604 通过，1 项 Windows 专属工具桥接跳过，无失败。本分支尚未包含媒体/赛季模块，最终集成计数另记。
- API 两个领域测试 14/14；`npm run typecheck`、改动文件 Prettier、`git diff --check` 通过。
- 新增 3 个真实 PostgreSQL 回归：锁屏障下最后一个入口名额的并发原编号重放、成功请求不擦除失败计数、授权时间微秒边界。当前执行环境没有可用 PostgreSQL 实例，这 3 项及既有真实 API 闭环**尚未在本轮执行**，交给总分支隔离 CI 验证，不能沿用旧 Windows 结果冒称通过。
- 没有修改 Migration 020/021，没有执行任何 Migration，没有 push、PR、生产或真实凭据操作。本模块提交交由集成人挑选整合。
