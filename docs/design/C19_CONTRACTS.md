# C19 接口冻结：小程序阶段交付（媒体幂等/分片、球队加入、私有赛季、关注）

2026-10-28 Asia/Shanghai；冻结时集成人 Claude Code，本次接续集成人 Codex。本文件是 C19 各模块并行实施前冻结的请求、响应、状态与权限。实施中发现与真实代码冲突时，由模块负责人在交接中写明，集成人在 [C19 任务卡](../tasks/C19.md) 记录取舍后再改本文件；不重新开展架构讨论。

依据：用户 2026-10-28 总任务提示（以下简称“总任务”）、[C15 媒体幂等修订版](C15_MEDIA_IDEMPOTENCY_PROPOSAL.md)、[C16 待审包](C16_PENDING_REVIEW.md)、[C14 §2–§4](C14_BACKEND_PROPOSALS.md)。总任务已对 C15/C16 的待定项拍板，以本文件为准。

## 0. 公共约定

- 所有私有路由沿用现有：Cookie 会话、`Origin` 校验、`{data, meta:{requestId}}` 信封、错误 `{error:{code,message,requestId}}`。
- 非工作人员/不可见资源 404，可见但无权 403；输入校验 422；CAS 失败 409 `VERSION_CONFLICT`；幂等内容不同 409 `IDEMPOTENCY_CONFLICT`。
- 加锁顺序沿用：会话/身份 → 机构 → 赛事 → 比赛/球队 → 本模块行。每个写命令同事务写审计；审计失败整体回滚。
- 原因文本：去首尾空白后 4–500 字。显示名只取 `users.display_name`，任何新接口都不返回他人邮箱或联系方式。
- 回执、请求标识、墓碑不自动过期，不允许旧 ID 重新执行。运行时角色不获得新表 DELETE；“清理”只把负载列置空并记终态。

## 1. Migration 编号与文件归属

| 编号 | 文件 | 模块负责人 | 新表（运行时权限由集成人写入清单） |
|---|---|---|---|
| 019 | `019_c19_media_requests.sql` | Agent 媒体 | `media_request_receipts`、`media_upload_sessions`、`media_upload_chunks` |
| 020 | `020_c19_team_membership.sql` | Agent 球队 | `team_request_links`、`team_requests`、`team_join_codes`、`team_member_bindings`、`team_member_claims` |
| 021 | `021_c19_event_follows.sql` | Agent 关注 | `event_follows` |
| 022 | `022_c19_private_seasons.sql` | Agent 赛季（依赖 020） | `seasons`、`season_events`、`season_data_grants` |

表名可按实现微调，最终以 Migration 为准，由集成人同步 `runtime-privileges.json`、表数与 Migration 数（readiness、privileges、backup/restore、restart/production 检查、c02/p07 测试）。不得修改 001–018。

实施订正：建队申请幂等身份保存在 `team_requests`，状态历史结合终态行与审计保存，不另建 `team_operations`。集成候选为 22 个 Migration、78 张表；备份隔离关闭未完成上传、释放分片负载并撤回待确认/已生效私有赛季授权，保留历史成员关系、回执及已完成文件。

共享文件只由集成人改：`packages/contracts/index.d.ts`、`apps/api/src/app.ts`、`apps/api/src/request-body.ts`、`apps/wechat/utils/api.js`（路径白名单）、`apps/wechat/app.json`、`packages/contracts/runtime-privileges.json`、计数脚本、汇总文档。冻结后各模块独占自己的契约文件 `packages/contracts/<模块>.d.ts`、服务/控制器/领域文件、迁移、测试、小程序页面与 utils；修改契约字段须在交接列明。

## 2. 媒体请求幂等与分片上传（Agent 媒体）

契约文件 `packages/contracts/media-requests.d.ts`；服务 `apps/api/src/media-request-service.ts`、控制器 `media-request-controller.ts`、领域 `media-request-domain.ts`。

### 2.1 请求幂等（按 C15 修订版，路由用普通形式）

| 方法 | 路径（前缀 `/v1/orgs/:orgId/matches/:matchId`） | 说明 |
|---|---|---|
| POST | `/media-file-requests` | `{clientRequestId, purpose, fileName, contentType, byteLength, contentSha256, contentBase64}`；首次 201，合法重放 200 |
| GET | `/media-file-requests/:clientRequestId` | 回执：`{state:'FILE', file}` 或 `{state:'SESSION', session}`；无则 404 `RECEIPT_NOT_FOUND` |
| POST | `/media-requests` | `{clientRequestId, kind, title, fileId?, externalUrl?, rightsDeclaration}` |
| GET | `/media-requests/:clientRequestId` | `{state:'MEDIA', media}`（当前 DTO，含 REVOKED） |

- 作用域 `(org, actor, match, operation, clientRequestId)`；operation ∈ `MATCH_FILE_UPLOAD`、`MATCH_MEDIA_CREATE`；`clientRequestId` 为 UUID v4。
- 顺序：会话 → 当前机构/比赛权限（与现有媒体管理权限完全相同：OWNER/ADMIN、本届 EVENT_MANAGER、STREAMER）→ 查回执比指纹 → 仅首次执行检查写状态、数量、额度。无权 403 时不泄露回执是否存在。
- 指纹：`sha256(JSON.stringify(["v1", operation, ...字段]))`，字段为**服务端实际写入的规范化值**；客户端用同一函数（`apps/wechat/utils/media-request.js` 与 `media-request-domain.ts` 共享已知向量测试）。NFC 等规范化只有在新接口实际执行时才可声称。
- 业务对象、回执、额度、审计同事务；并发同 ID 只执行一次（唯一约束 + 冲突时回滚后新事务读回执，或 SAVEPOINT）。重放不重复计费、计数或追加业务审计。
- 旧 `POST …/media-files`、`POST …/media`、报名文件入口不变。

### 2.2 分片上传会话

| 方法 | 路径（同前缀） | 说明 |
|---|---|---|
| POST | `/media-upload-sessions` | `{clientRequestId, purpose, fileName, contentType, byteLength, contentSha256}`；创建即占用该 `clientRequestId` 的 `MATCH_FILE_UPLOAD` 回执（状态 SESSION） |
| GET | `/media-upload-sessions/:sessionId` | `{id, status, byteLength, chunkSize, chunkCount, receivedBytes, chunks:[{index,byteLength,sha256}], expiresAt, file?}` |
| PUT | `/media-upload-sessions/:sessionId/chunks/:index` | `{byteLength, sha256, contentBase64}`；同序同内容幂等，不同内容 409 `CHUNK_CONFLICT` |
| POST | `/media-upload-sessions/:sessionId/complete` | 组装校验后创建文件并把回执置为 FILE；返回 `{state:'FILE', file}`；重放返回同一结果 |
| POST | `/media-upload-sessions/:sessionId/cancel` | 释放预留与分片负载；终态保留，请求标识不可再用 |

- 状态 `OPEN → COMPLETED | CANCELLED | EXPIRED`；分片 512 KiB（524288），末片按实际剩余；总大小、类型规则与 8 MiB 上限不变。
- 会话 24 小时有效，重复请求不续期；只有创建者在当前仍有权限时操作；完成时校验总长度、整体 SHA-256 与既有文件格式规则。
- 同一 `clientRequestId` 不能既走单次上传又走分片完成产生两份文件：已有 SESSION 回执时单次上传返回 409 `UPLOAD_SESSION_ACTIVE`（会话终态 CANCELLED/EXPIRED 后同 ID 永不再执行，返回 409 `REQUEST_CLOSED`）。
- 机构额度 = 有效文件字节 + OPEN 且未过期会话的预留字节；每用户每机构 OPEN 会话至多 2 个，每机构至多 8 个。
- 取消/过期释放预留并把分片负载置空，回执保留终态；已完成文件不受会话清理影响。取消与完成竞争以事务结果为准。
- 清理：请求路径内有界地处理本模块过期会话（同机构，每次至多 N 条），并提供既有维护脚本可调用的有界函数；不宣称后台自动运行。
- 请求体：集成人只给 `media-file-requests`（12 MB，与旧单次上传同槽）与 `chunks/:index`（1 MB）配置上限，不放宽全局入口。

### 2.3 小程序

`apps/wechat/utils/media-request.js`（新）、`pages/match-media` 页面。先持久化原请求编号与不可变元数据再发送；存储失败不发送、不淘汰未解决记录；换账号/卸载/异步准备后失效零写；未知先查回执，404 不换编号；文件丢失/摘要变化不发送；旧版未知记录保留人工核对路径。进度只显示“服务端已确认 X / Y 字节”，分片完成与最终校验分开，最终回执后才显示成功。上传暂存文件与私有预览不同前缀和登记。

## 3. 申请建队、加入与成员绑定（Agent 球队）

契约 `packages/contracts/team-membership.d.ts`；服务 `apps/api/src/team-membership-service.ts`、控制器 `team-membership-controller.ts`、领域 `team-membership-domain.ts`；修复 `registration-service.ts#updateTeamMembers` 的“全队先归档再恢复”。

### 3.1 申请建队分享入口与申请

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/v1/orgs/:orgId/team-request-links` `{expiresInHours(1–168), maxUses(1–200), reason}` → 含一次性 `token` | OWNER/ADMIN |
| GET | `/v1/orgs/:orgId/team-request-links` | OWNER/ADMIN |
| POST | `/v1/orgs/:orgId/team-request-links/:linkId/revoke` `{reason}` | OWNER/ADMIN |
| POST | `/v1/team-request-links/resolve` `{token}` → `{linkId, orgName, expiresAt}` | 已登录 |
| POST | `/v1/team-requests` `{token, clientRequestId, teamName, note?}` | 已登录本人 |
| GET | `/v1/me/team-requests` | 本人 |
| POST | `/v1/me/team-requests/:requestId/withdraw` `{expectedVersion}` | 申请人 |
| GET | `/v1/orgs/:orgId/team-requests?status=` | OWNER/ADMIN |
| POST | `/v1/orgs/:orgId/team-requests/:requestId/review` `{decision:'APPROVE'|'REJECT', reason, expectedVersion}` | OWNER/ADMIN，且≠申请人 |

- 令牌 128 位随机，服务端仅存 SHA-256；不可猜测、限期、限次、可撤销。只展示该入口机构名称；无匿名机构搜索，不接受手填 orgId 提交申请。
- 状态 `PENDING → APPROVED | REJECTED | WITHDRAWN`；提交按 `(requester, clientRequestId)` 持久去重。批准事务：创建球队 + 授予申请人该队 `TEAM_MANAGER`（`team_access_grants`）+ 保存结果 + 审计；最多一支球队；不授机构成员或赛事工作人员角色。

### 3.2 加入码、绑定与历史成员认领

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/v1/orgs/:orgId/teams/:teamId/join-codes` `{expiresInHours?, maxUses?}` → 含一次性 `code` | 该队管理者（OWNER/ADMIN 或有效 TEAM_MANAGER） |
| GET | `/v1/orgs/:orgId/teams/:teamId/join-codes` | 同上 |
| POST | `/v1/orgs/:orgId/teams/:teamId/join-codes/:codeId/revoke` | 同上 |
| POST | `/v1/team-joins` `{code, displayName}` → `MembershipData` | 已登录本人 |
| GET | `/v1/orgs/:orgId/teams/:teamId/member-bindings` | 该队管理者；只返回成员名、绑定账号显示名、状态 |
| POST | `/v1/orgs/:orgId/teams/:teamId/member-bindings/:bindingId/remove` `{reason}` | 该队管理者 |
| POST | `/v1/orgs/:orgId/teams/:teamId/members/:memberId/claims` `{targetUserId}` | 该队管理者 |
| POST | `/v1/orgs/:orgId/teams/:teamId/member-claims/:claimId/revoke` | 该队管理者 |
| GET | `/v1/me/member-claims` | 目标本人 |
| POST | `/v1/me/member-claims/:claimId/accept` / `/decline` | 目标本人 |
| GET | `/v1/me/memberships` | 本人：“我的成员关系” |
| GET | `/v1/me/memberships/:bindingId/team` | 本人只读：队名、成员显示名、本人绑定状态 |
| POST | `/v1/me/memberships/:bindingId/leave` | 本人 |

- 加入码 128 位随机，Base32 展示（26 字符），只存 SHA-256；默认 7 天、30 次；可撤销；使用时机构 ACTIVE、球队存在、签发者仍有管理权。失败按账号与可信 IP 限流（每分钟 10 次，复用 `auth_rate_limits`）。
- 正常加入：新建 `team_members` 行 + 本人绑定，不按姓名匹配旧成员；重复加入返回原绑定且不重复计次；并发计次不超发（条件 UPDATE … RETURNING）。
- 被移除/退出者不能用移除前签发的码重新加入（码 `created_at` 早于该账号在该队最近一次移除/退出时间则拒绝 `JOIN_CODE_PREDATES_REMOVAL`）。
- 认领：精确 `memberId` + 目标账号的定向单次认领；本人接受后生效；不覆盖其他账号的绑定，不按姓名或邮箱推断。
- 约束：同队同账号至多一个有效绑定；同成员至多一个有效绑定；复合外键保证机构、球队、成员归属；历史保留，不改冻结报名快照。
- **普通球员绑定绝不写入 `team_access_grants`，也不进入会话里的管理用 `teamContexts`。**
- 成员保存只归档实际被移除的成员；被移除成员的有效绑定同事务结束（`ended_reason='MEMBER_REMOVED'`），保留成员的绑定与授权不受影响。

## 4. 赛事关注（Agent 关注）

契约 `packages/contracts/event-follows.d.ts`；服务 `apps/api/src/event-follow-service.ts`、控制器 `event-follow-controller.ts`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/me/follows` `{publicEventId}` | 服务端检查该公开身份当前有效可读；重复请求返回同一关注（幂等） |
| GET | `/v1/me/follows?limit=&cursor=` | 本人；键集分页（limit 默认 20，最大 50） |
| GET | `/v1/me/follows/lookup?publicEventId=` | `{follow|null}` |
| POST | `/v1/me/follows/:followId/cancel` | 取消不要求原公开发布仍有效；重复取消幂等 |

- 关注绑定公开发布身份（`public_event_publications` 行）。目录 UNLIST 不取消关注；公开发布撤销后旧关注读取为 `INVALID`，新公开键不继承。
- `FollowData = {followId, publicEventId, status:'ACTIVE'|'INVALID'|'CANCELLED', event: {name,startDate,endDate,status,purpose} | null, createdAt, cancelledAt}`；INVALID/CANCELLED 时 `event=null`，不返回已收回资料。
- 本轮不调用微信发送：响应与页面把“关注成功”与“微信提醒未启用”分开表达。

## 5. 私有赛季与独立数据授权（Agent 赛季，依赖 §3 绑定）

契约 `packages/contracts/private-seasons.d.ts`；服务 `apps/api/src/season-service.ts`、控制器 `season-controller.ts`、领域 `season-domain.ts`。

| 方法 | 路径 | 权限 |
|---|---|---|
| GET/POST | `/v1/orgs/:orgId/seasons` | OWNER/ADMIN |
| GET/PATCH | `/v1/orgs/:orgId/seasons/:seasonId` | OWNER/ADMIN |
| POST | `/v1/orgs/:orgId/seasons/:seasonId/commands` `{type:'ACTIVATE'|'CLOSE'|'ATTACH_EVENT'|'DETACH_EVENT', eventId?, expectedVersion}` | OWNER/ADMIN |
| GET | `/v1/orgs/:orgId/seasons/:seasonId/player-statistics` | OWNER/ADMIN |
| GET | `/v1/orgs/:orgId/events/:eventId/season-data-grants` | 该届提名权人 |
| POST | `/v1/orgs/:orgId/events/:eventId/season-data-grants` `{clientRequestId, teamId, memberId, targetUserId, reason}` | 当前有权的主办方（OWNER/ADMIN 或该届 EVENT_MANAGER） |
| POST | `/v1/orgs/:orgId/season-data-grants/:grantId/withdraw` `{reason, expectedVersion}` | 同上 |
| GET | `/v1/me/season-data-grants` | 本人 |
| POST | `/v1/me/season-data-grants/:grantId/commands` `{type:'CONSENT'|'DECLINE'|'REVOKE', expectedVersion}` | 被提名本人 |
| GET | `/v1/me/season-statistics?orgId=&seasonId=` | 本人只看本人 |

- 赛季 `DRAFT → ACTIVE → CLOSED`；赛事显式归入，首版每赛事至多一个赛季；赛事日期须在赛季范围内；CLOSED 锁定配置与归属，但不冻结隐私撤销与赛果有效性。
- 授权用途固定 `PRIVATE_SEASON`，状态 `PENDING → ACTIVE | DECLINED | WITHDRAWN`，`ACTIVE → REVOKED | WITHDRAWN`；与 C07 `booking_performance_links` 互不替代、互不自动创建；重新绑定或重新授权不复活旧授权（新行）。
- 进入聚合需同时满足：授权 ACTIVE、目标账号当前对该冻结来源成员所在长期成员有有效绑定（§3）、来源仍属该届冻结名单、提名人当前仍有提名权。下一次读取即剔除失效项。
- 失效永久留痕：绑定结束、机构/相关账号停用或提名人失去最后一路提名权时，原变更事务登记 `invalidated_at/invalidation_reason`，保留原同意历史。恢复权限不清除此证据；并发撤销两路权限按机构和提名人串行检查。重新生效需要新提名和新同意。
- 聚合复用 `confirmed-player-statistics.ts` 的确认来源与计算；同机构按账号聚合、不跨机构；`sourceHash` 覆盖赛季版本、赛事集合、授权与确认来源；首版不缓存；未采集项显示“未统计”；名单场次不称出场。
- 无当前有效逐人样本时不生成球员排名行；有已确认样本但得分为零时仍显示真实零分。
- 管理某一届的 EVENT_MANAGER 不因此获得全机构赛季数据；无匿名查询。

分页实施：本人授权、机构赛季列表、赛事授权记录均接受 `limit/cursor`，默认与最大每页 50。机构赛季列表保持 `data` 数组并在 `meta.nextCursor` 返回游标；两类授权列表在 `data.nextCursor` 返回游标。赛季详情的候选赛事接受 `candidateLimit/candidateCursor`，返回 `candidateNextCursor`，每页同样最多 50。分页始终重新执行当前权限检查，不静默截断历史资料；候选页在赛季版本变化时要求刷新。创建赛季与提名在发送前持久化当前账号的原编号及原请求体，未知结果跨页面仍按原编号核对，存储失败不发送。

## 6. 小程序入口（集成人分配页面）

| 页面 | 负责人 | 用途 |
|---|---|---|
| `pages/match-media`（改） | 媒体 | 幂等上传、分片进度、回执恢复 |
| `pages/team-request`（新） | 球队 | 申请人：解析分享入口、提交、我的申请、撤回 |
| `pages/team-requests`（新） | 球队 | 机构 OWNER/ADMIN：分享入口生成/撤销、审批 |
| `pages/team-join`（新） | 球队 | 球员输入加入码、接受认领 |
| `pages/memberships`（新） | 球队 | 我的成员关系、只读球队、退出 |
| `pages/team`（改） | 球队 | 领队发码/撤销、绑定列表/移除、发起认领 |
| `pages/follows`（新）、`pages/event`（改） | 关注 | 关注/取消、我的关注 |
| `pages/seasons`（新）、`pages/season-grants`（新） | 赛季 | 赛季管理与机构榜；本人授权与本人统计 |
| `pages/account`（改，集成人） | 集成人 | 入口分组 |

页面注册（`app.json`）与 account 入口由集成人在集成时添加；模块负责人在交接中列出需要的路由。
