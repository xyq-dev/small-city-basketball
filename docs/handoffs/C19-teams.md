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
- 每人每机构至多 3 份 PENDING（防刷，新增约束，见“冲突与取舍”）。
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
5. `remove` 与 `leave` 同时把成员移出长期名单（“移除/退出球队”语义）；若仅需解绑而保留成员，需领队之后在长期名单里另行处理（当前 UI 不提供恢复已归档成员）。
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
