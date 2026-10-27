# C19 交接：申请建队 / 加入 / 成员绑定（Agent 球队）

分支 `c19/teams`（基于集成提交 2eac213），worktree `D:\Projects\scb-c19-teams`。状态：进行中（本节为早期提交给 Agent 赛季的绑定契约，后续章节完成后补全）。

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
