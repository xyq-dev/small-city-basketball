# 数据模型与状态

设计版本：0.1；更新：2026-10-22；状态：P02、P03-A及P04-A SQL模型已合并main，001–003已在隔离PostgreSQL18.6测试库执行及复跑校验，无生产执行。第2–5节包含长期逻辑设计，实际已建表和验收边界见第6–8节；记分、保险附件和OBS等后续实体尚未建表。

## 1. 通用约束

P02主键使用服务端生成的UUID；后续实体沿用不透明ID原则。时间戳使用 UTC，赛事保留 IANA `timezone` 用于展示和排期；`startDate/endDate` 是该时区的赛事日期，场次实际开球使用带时区时间戳。机构范围的业务资源含 `orgId`、创建/更新时间及必要的 `version`；User 等全局身份实体不强行绑定唯一机构。数据库不以本地日期字符串排序代替真实开球时间。

带机构范围的父表建立 `UNIQUE(orgId,id)`；子表用复合外键引用同机构父资源。名单、场次、事件还校验相同赛事归属。业务标识及唯一性以归一化结果约束，不只依赖前端查重。

## 2. 核心实体

| 实体 | 主要字段与关系 | 关键约束 |
|---|---|---|
| User | id、登录主体引用、公开昵称 | 登录主体唯一；私密身份资料独立保护 |
| Organization | id、name、status | 禁用机构阻止新增写入，保留授权读取策略 |
| OrganizationMembership | orgId、userId、role、status | 同机构同用户唯一；权限变更审计 |
| EventStaff | orgId、eventId、userId、role、可选matchId | 授权范围不能超出所属赛事 |
| EventSeries | orgId、name、品牌引用 | 可选的长期赛事品牌，关联多届赛事；P01 不建立 |
| Event | orgId、可选seriesId/seasonLabel/editionLabel、name、startDate、endDate、timezone、可空venueName、format、status、version | 日期有序；format 为约定枚举；创建状态 DRAFT；P01不要求设置系列 |
| Division / CompetitionStage / Group | orgId、eventId；组别/阶段/小组名称、顺序、规则版本与晋级来源 | P04按需新增；阶段与小组均属于同一届赛事，不能将所有小组积分混算 |
| EventRuleset | orgId、eventId、version、rules、lockedAt | 同赛事版本唯一；使用后的版本不可覆盖 |
| Team / TeamMember | orgId、name、badge；teamId、可选userId、展示资料 | 长期球队档案；证件不放公开成员字段 |
| TeamAccessGrant | orgId、teamId、userId、role、status、可选expiresAt | 领队/球队管理授权独立于机构成员；授权撤销后不能继续操作本队报名 |
| ParticipantLink / Invitation | orgId、entryPlayerId、userId、status；邀请用途、受邀对象、资源范围、令牌hash、expiresAt、acceptedAt | 本人身份绑定可追溯；邀请限期且一次接受，不能靠客户端userId认领他人资料；接受不授予工作人员身份 |
| EventEntry | orgId、eventId、teamId、teamNameSnapshot、status、version | 同赛事同球队唯一；外部导入先生成本机构授权档案/快照 |
| EntryPlayer | orgId、eventId、entryId、memberId、nameSnapshot、jerseyNo、eligibilityStatus | 本届名单独立保存；号码在当前有效报名名单内唯一 |
| PrivateParticipantData | orgId、entryPlayerId、受保护身份/联系信息引用 | 单独权限；不作为公开球员 DTO 的默认关系 |
| InsuranceEvidence | orgId、entryPlayerId、objectKey、source、reviewStatus、reviewerId | 凭证文件私有；EXTERNAL 仅表示来源，不等于审核通过 |
| Venue / Court | orgId、name、位置说明；venueId、courtName | 场地冲突以 courtId 和时间区间判断 |
| Draw / ScheduleRevision | orgId、eventId、rulesetVersion、输入/随机结果快照、version、发布人 | 重抽说明原因；发布版本不可原地改写 |
| Match | orgId、eventId、scheduleRevisionId、适用的divisionId/stageId/groupId、双方entryId、courtId、startsAt、status、version | 双方不同且属于本赛事；阶段/小组归属一致；锁定使用的规则版本 |
| MatchRoster | orgId、matchId、entryPlayerId、比赛名单快照 | 只能来自批准报名名单；赛后人员变动不改历史 |
| MatchEvent | orgId、matchId、seq、commandId、type、payload、actorId、captureTime、serverTime、correctionOf | `(matchId,seq)`唯一；事件追加；修正引用同场合法事件 |
| MatchProjection / ClockState | orgId、matchId、比分/统计、sourceVersion；计时锚点 | 一场一份当前投影；记录采集模式及未采集字段 |
| ScorekeeperLease | orgId、matchId、holderId、deviceId、expiresAt、fencingToken | 一场一个有效主写租约；转移递增栅栏版本 |
| ResultConfirmation | orgId、matchId、matchVersion、确认人、结果快照 | 每个确认版本不可变；重开保留旧确认历史 |
| StandingProjection | orgId、eventId、适用的divisionId/stageId/groupId、rulesetVersion、sourceResultVersion、排名数据 | 仅基于已确认赛果；重算不能混入旧版本和不同组别/小组 |
| IdempotencyRecord / AuditLog / Outbox | 请求作用域及hash/结果；操作者及变更引用；已提交待投递事件 | 与相关业务事务一致；重放仍需重新鉴权 |

BroadcastSession、MediaAnchor、OverlayGrant、SponsorPlacement、Entitlement 和 UsageLedger 在对应阶段新增。视频存引用与时长/用量，不存二进制；软件权益与视频用量分账。支付、退款、保险交易模型尚未定稿，不把报名审核状态当作支付状态。

P06 的扩展对象至少定义：直播会话所属机构/比赛/云端流引用及状态；媒体锚点所属录制分段、比赛版本、媒体偏移及误差；包装授权的比赛/字段范围、有效期及撤销状态；赞助素材的所属机构、展示位、适用赛事、排期和批准记录；权益的计量单位、限额、有效期与来源；用量台账的业务来源、数量及唯一去重键。额度与计量更正使用追加记录，不能靠覆盖历史用量解决。具体表结构和服务订单、支付状态在专项任务中定稿，不在 P01预建。

## 3. 规则快照

`format` 固定为 `ROUND_ROBIN`、`GROUP_KNOCKOUT`、`SINGLE_ELIMINATION`。长期规则版本将包含报名人数、参赛资格、节次/时长、加时、犯规/暂停、积分及同分排序、赛制晋级、最低休息间隔和排赛约束等；P03-A只实现第7节列出的报名规则，不表示三种赛制已可排赛。实际赛事逐项设置并确认，不能全平台固定“8队16场”“19:30/20:15”或某届的户籍条件。

排赛规则区分硬约束与可提示的偏好；系统无解时输出冲突证据及可放宽项，不偷偷放宽。手动调赛生成新版本并重跑校验；已开赛或已确认场次不能被普通排赛覆盖。

## 4. 状态机与守卫

- **赛事**：`DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → SCHEDULED → RUNNING → COMPLETED → ARCHIVED`；允许受控 `CANCELLED`。P01 仅创建/编辑 DRAFT。开放报名、发布赛程、结束和归档分阶段实施；COMPLETED 要求必要比赛已确认或有明确取消/弃权处置，不仅是比分已填。
- **报名**：`DRAFT → SUBMITTED → APPROVED / CHANGES_REQUESTED / REJECTED`；CHANGES_REQUESTED 补齐后重新提交；未锁定前可按规则 WITHDRAWN。审批操作者、理由和版本需保留。
- **保险凭证**：`PENDING → APPROVED / REJECTED`，规则不要求保险时可标 `NOT_REQUIRED`。凭证批准只表示本赛事审核结论，不保证理赔或替代承保方判断。
- **比赛**：`SCHEDULED → READY → LIVE → PENDING_CONFIRMATION → FINAL`；另有 `POSTPONED / CANCELLED`。不能从 LIVE 直接成为正式赛果。READY 校验名单、规则及工作人员；结束计分进入待确认。FINAL 更正需有权限的重开命令回到 PENDING_CONFIRMATION，该状态只允许受控更正及确认，不继续正常实时计分。再次确认后更新榜单；若更正影响已排定或已开赛的下游晋级场次，应阻断自动改写并交赛事管理员处置。延期恢复、弃权、争议处置必须记录原因，不直接删除比赛。
- **赛程版本**：P04-A只有当前`DRAFT → PUBLISHED`，重抽把旧DRAFT变为SUPERSEDED并创建新DRAFT；已发布版本不能变为SUPERSEDED或被替换。发布校验冻结球队、时间、场地及规则来源；后续发布后改期另开有恢复方案的任务。

删除已参赛球队、已使用规则或已开赛场次应拒绝或归档，不能级联删除历史。个人数据保留、注销和匿名化策略在真实资料上线前确定，业务历史与敏感原文分别处理。

## 5. 必要索引与验证

优先建立成员 `(orgId,userId,status)`、赛事 `(orgId,status,startDate)`、报名 `(orgId,eventId,status)`、比赛 `(orgId,eventId,startsAt)`、场地时间检索及事件 `(matchId,seq)`。幂等唯一键包含机构、操作者、命令作用域及幂等键；只存业务所需的最小响应。P04-A已用GiST排他约束、机构mutex及真实并发用例验证本机构Court/Team占用；记分等后续实体仍需各自验证。

必须验证跨租户外键、外部参与者资源授权及撤销、邀请冒领/重放/过期、重复报名/号码、规则锁定、旧版本写入、租约转移、重复事件/补偿、重开赛果与榜单重算。P02/P03-A/P04-A适用范围已执行，后续记分等行为仍待相应阶段验证。Migration001–003的执行事实见下文，不把规划实体也标成已建表。

## 6. P02 最小持久化实施

Migration `apps/api/migrations/001_p02_foundation.sql` 已编写、审查并在隔离PostgreSQL18.6测试库真实执行，重复运行及校验和验证通过；PR #2已合并main。具体环境与证据见[P02交接](handoffs/P02.md)。没有生产数据库或生产执行记录，不能将测试执行称为生产已更新。P02使用pg参数化SQL，不引入ORM。

实际表：users、organizations、organization_memberships、sessions、events、event_staff、audit_logs、auth_rate_limits。UUID由服务端生成，UTC时间，赛事日期读为YYYY-MM-DD字符串。角色与status有CHECK；机构内复合唯一/外键保证event_staff所属赛事和成员同机构；一个机构仅一个OWNER，P02接口禁止变更OWNER。

写事务内锁会话/用户、机构、成员、赛事及必要分配；被撤权对象的更新与在途业务写按数据库锁串行。赛事FOR UPDATE后检查expectedVersion，成功递增version并同事务追加审计，审计失败回滚赛事变更。登录/退出也记录最小审计引用，不记录密码、令牌或完整请求。

Migration runner使用事务advisory lock、文件名白名单及SHA-256校验和，重复执行核验并跳过，不在API启动自动运行。开发seed需显式DEV_SEED_PASSWORD，禁止production，幂等不清库、不重置已有密码；生产凭据与开发合成数据分开。GitHub CI隔离PostgreSQL18.6已完成真实验证；数据库重启后会话、赛事、version、授权、审计及迁移校验和保留。当前没有生产数据库；重启持久化不是备份恢复或生产可用性验收。

## 7. P03-A报名持久化（DONE / MAIN，隔离测试库已执行）

P03-A经[PR #3](https://github.com/xyq-dev/small-city-basketball/pull/3)合并main `1c4b352e4277af6a418ae46908d1aed0fcb01827`。`002_p03_registration.sql` 的SHA256为 `13f3729b86305745c5e1a986f7cd533eb99f9cd96052d630de6607e8394576e4`。[最终CI39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)在隔离PostgreSQL18.6执行001→002，复跑核验并跳过已匹配的迁移，44项独立PG场景通过；真实数据库重启后会话、球队授权、名单版本、freeze、审计及校验和保留。前两轮失败及最终浏览器通过见[TESTING](TESTING.md)；没有生产执行。

新增teams、team_members、team_access_grants、team_invitations、event_rulesets、entries、entry_roster_revisions、entry_roster_players、entry_review_history及registration_freezes。事件追加可空当前/锁定规则指针，兼容001已有赛事；复合FK约束同机构、赛事、球队、报名revision及来源成员。

长期成员移出归档；每次报名名单保存新revision和姓名/号码快照。规则、roster revision/players、review history和freeze通过触发器拒绝UPDATE/DELETE；API只能向刚建立的新revision插入players，不提供向旧revision追加球员接口。名单锁与冻结JSON的一致性由应用事务保证，已通过真实PG并发、审计回滚及重启验证。

报名/审核/冻结写均持同一Event UPDATE锁，再按Team→grant→Entry顺序处理；全部grant创建、启用、撤销及邀请接受持同Team UPDATE锁，审核在锁内检查当前非领队。邀请接受还锁住邀请人的有效membership到提交。freeze由服务端批准entry当前revision及锁定规则生成，与审计同事务；长期成员变动不能回写旧名单。

本卡规则字段为min_players、max_players、zero_and_double_zero_distinct、require_identity、require_insurance；同赛事版本唯一，开放报名后锁定规则指针。后两项要求为true时拒绝开放，因为核验与保险附件尚未集成。TeamAccessGrant只有TEAM_MANAGER，与organization_memberships独立；team_invitations绑定已存在target_user_id，数据库只存令牌hash及用途、期限、消费／撤销时间。已消费邀请仅在全部验证通过且当前grant仍ACTIVE时安全重读上下文，缺失或DISABLED不会复活。

报名列表投影仅返回EntrySummary九字段；完整roster、rules、history由独立鉴权的详情接口返回。这是响应裁剪，不删除数据库中的历史。P03-A名单冻结后事件保持REGISTRATION_CLOSED，不自动生成赛程或比赛；P04-A再显式生成及发布，公开观赛和OBS投影仍未实现。

## 8. P04-A排赛持久化（DONE / MAIN，隔离测试库已执行）

[PR #4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并main `9fc9b3019eeef52d5b7a66643b01f0fe993af09f`；代码 `7336bfa01a6a3b6afb08dd2c90260f8497b1239e` 经[CI39737812114](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114)全部成功。`003_p04_scheduling.sql`的SHA256为`6469c7d5783ac1c025c0981addb8da77d0174169556b79e971347cd5ea78122f`。001→002→003已在隔离PostgreSQL18.6执行，复跑校验和并跳过已应用版本；68项独立PG场景通过（P02 20＋P03-A 24＋P04-A 24）。真实数据库重启后已发布排赛、正式场次、预约及原授权／名单／审计／校验和保持，详见[TESTING](TESTING.md)。无生产执行。

| 新增表 | 责任与关键约束 |
|---|---|
| courts | org共享稳定场地，规范化名称唯一、ACTIVE/DISABLED及CAS版本 |
| org_schedule_mutex | org_id主键；写场地及发布同事务INSERT ON CONFLICT后FOR UPDATE，覆盖既有和新机构 |
| schedule_revisions | freeze/source/policy/seed/hash/轮次及顺序、DRAFT/SUPERSEDED/PUBLISHED、版本和重抽历史；来源始终不可改 |
| schedule_fixtures | 主键(org_id,revision_id,fixture_key)，双方entry/team及轮次固定；仅DRAFT可改场地和时间分配 |
| schedule_publications | event唯一发布，绑定revision及publicationHash；禁止更新、删除或发布后追加篡改 |
| published_matches | 固定双方entry/team/name/rosterRevision、courtName、时间及来源引用；初始SCHEDULED/version1，只有status/version预留给后续受控记分 |
| court_reservations | 每场一条，主键(org_id,match_id)，正式场地及半开时间占用 |
| team_reservations | 每场每队一条，主键(org_id,match_id,team_id)，按长期canonical Team防跨赛事重叠 |

同时增加events.current_schedule_revision_id及registration_freezes复合唯一键。真实复合FK约束org/event/revision/entry/team/roster来源；每场一Court、两Team，`btree_gist`与`tstzrange(starts_at,ends_at,'[)')`GiST排他约束防同机构同资源重叠。发布后来源、fixtures、publication、reservations不可更新、删除或追加；match计划事实不可变，尚无修改status接口。P05须用独立状态实体保存比分及clock，不能借status/version接口改计划。

发布及Court写按session/user→org→membership→org_schedule_mutex→event（如适用）→revision→Court顺序锁定，不升级org SHARE。发布从服务器freeze与seed重算对阵和占用；同事务写publication→matches→每场1court/2team预约→revision PUBLISHED→event SCHEDULED/version→audit。revision完整性触发器及deferred提交约束阻止半份发布。双赛事争抢Court／同Team、缺mutex行首次并发、Court停用竞态、机构隔离及审计失败整体回滚均经真实PG验证。

本卡只支持2–32队单回合ROUND_ROBIN、显式占用／休息／本地日期间隔及时间窗口、手工分配和一次发布。重抽新建来源、旧稿SUPERSEDED只读；没有自动排时、淘汰／分组、改期或释放预约。机构内canonical Court/Team协调不等于跨机构物理场地共享；完整P04及P05/P06仍未完成。
