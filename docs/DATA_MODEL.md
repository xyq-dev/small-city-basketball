# 数据模型与状态

## EXPANSION8：036—041分支模型（隔离首次执行成功，生产未执行）

本轮48张新表，全链175表/117函数，旧001—035不修改。以下以实际DDL清单为准；首次成功执行后新迁移冻结，后续变更另加迁移。支付/退款/保单/停播外部事实与工作意图分开，不能用界面成功或过期令牌代替真实回执。

| 迁移                        | 新表数 | 表                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 036_e01_streaming_media.sql | 8      | `live_channel_accounts`, `broadcast_sessions`, `live_relays`, `stream_command_receipts`, `stream_jobs`, `stream_usage_ledger`, `live_media_jobs`, `live_media_artifacts`                                                                                                                                        |
| 037_e03_insurance.sql       | 11     | `insurance_configuration`, `insurance_products`, `insurance_quotes`, `insurance_orders`, `insurance_policy_facts`, `insurance_operations`, `insurance_receipts`, `insurance_provider_events`, `participant_qualification_requests`, `participant_qualification_prechecks`, `participant_qualification_receipts` |
| 038_e04_trade.sql           | 10     | `trade_terms`, `trade_orders`, `trade_payment_attempts`, `trade_refunds`, `trade_deductions`, `trade_settlements`, `trade_provider_events`, `trade_operations`, `trade_reconciliations`, `trade_settlement_returns`                                                                                             |
| 039_e05_notifications.sql   | 10     | `notification_configuration`, `notification_source_events`, `notification_messages`, `notification_subscription_intents`, `notification_subscription_grants`, `notification_deliveries`, `notification_fanout_state`, `notification_delivery_attempts`, `notification_commands`, `notification_start_scan`      |
| 040_e07_account_closure.sql | 3      | `account_closure_requests`, `account_closure_operations`, `account_closure_tombstones`                                                                                                                                                                                                                          |
| 041_e08_youth_guardians.sql | 6      | `youth_event_policies`, `youth_guardian_preconsents`, `youth_guardian_requests`, `youth_guardian_history`, `youth_guardian_commands`, `youth_preconsent_history`                                                                                                                                                |

敏感保单/监护证明/通知目标单独加密，当前同意按来源/用途/版本读取；append-only事实及receipt不允许普通runtime UPDATE/DELETE。`trade_orders.money_version`在新实际账务事实同事务递增，对账精确pin后才可分账。审计表runtime仅INSERT及action/resource_type两列SELECT以检查永久恢复marker，不能读metadata/actor。MP4为独立媒体卷文件，artifact表只保留路径/大小/哈希与授权元数据；数据库备份不包含媒体字节。

## EXPANSION8 分支数据增量

E06不新建搜索身份库或长期索引，直接按当前有效event_directory_listings/public_event_publications及public_archive_profiles/publications/sources投影，在同授权snapshot内验证。候选分页只保公开键和查询scope，源撤回不会因索引延迟继续可见。其余036—041为当前分支实施草稿，执行与冻结状态以[父任务](tasks/EXPANSION8.md)及迁移源码为准，尚未进行本轮数据库执行或生产修改。

## COMPLETION22 当前持久化增量

2026-10-31 Asia/Shanghai；当前整合范围累计35项Migration、127张表，025—035新增44表并扩展既有比赛/采集约束。执行与合并事实见[当前状态](CURRENT_STATUS.md)，仅在隔离CI验证，不代表生产Migration已执行。下方早期阶段的“待新增”“仅三赛制”等历史描述不覆盖本节与第3节当前规范。

| Migration                                                                                         | 新增表/变更范围                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [025_x01_third_place.sql](../apps/api/migrations/025_x01_third_place.sql)                         | 扩展既有表/函数及约束，不新增表                                                                                                                                                                                                                                                                                        |
| [026_x03_scheduling_templates.sql](../apps/api/migrations/026_x03_scheduling_templates.sql)       | `event_templates`, `event_template_versions`, `event_template_instances`, `event_template_commands`                                                                                                                                                                                                                    |
| [027_x05_recruitment_posters.sql](../apps/api/migrations/027_x05_recruitment_posters.sql)         | `recruitment_publications`, `recruitment_applications`, `event_team_import_previews`, `event_invitations`, `recruitment_request_receipts`, `poster_exports`                                                                                                                                                            |
| [028_x08_professional_statistics.sql](../apps/api/migrations/028_x08_professional_statistics.sql) | 扩展既有表/函数及约束，不新增表                                                                                                                                                                                                                                                                                        |
| [029_x12_local_services.sql](../apps/api/migrations/029_x12_local_services.sql)                   | `local_listings`, `local_slots`, `local_bookings`, `local_matchups`, `local_resource_reservations`, `local_command_receipts`, `local_service_history`                                                                                                                                                                  |
| [030_x18_governance.sql](../apps/api/migrations/030_x18_governance.sql)                           | `governance_operations`, `city_operation_grants`, `governance_cases`, `governance_case_messages`, `governance_case_attachments`, `governance_reviews`, `sponsorship_campaigns`, `sponsorship_publications`, `sponsorship_impressions`, `public_ledger_accounts`, `public_ledger_entries`, `public_ledger_publications` |
| [031_x22_account_recovery.sql](../apps/api/migrations/031_x22_account_recovery.sql)               | `account_mail_configuration`, `account_action_requests`, `account_action_tokens`, `account_action_cancellations`, `account_mail_jobs`                                                                                                                                                                                  |
| [032_x08_public_archives.sql](../apps/api/migrations/032_x08_public_archives.sql)                 | `public_archive_profiles`, `public_archive_publications`, `public_archive_sources`, `public_archive_operations`                                                                                                                                                                                                        |
| [033_x02_match_exceptions.sql](../apps/api/migrations/033_x02_match_exceptions.sql)               | `match_exception_rules`, `match_exception_heads`, `match_exception_requests`, `match_exception_receipts`                                                                                                                                                                                                               |
| [034_x08_scoring_offline_intents.sql](../apps/api/migrations/034_x08_scoring_offline_intents.sql) | `scoring_offline_intents`                                                                                                                                                                                                                                                                                              |
| [035_x17_staff_configuration.sql](../apps/api/migrations/035_x17_staff_configuration.sql)         | `staff_configuration_receipts`                                                                                                                                                                                                                                                                                         |

双循环必须在events.format与schedule_revisions.algorithm_version中同时匹配，使用独立DRR_CIRCLE_V1，不能把双回合拼入单循环来源。季军赛复用既有晋级来源及发布结构；半决赛负者proof、闭赛场数和完整赛事权益同时校验。行政结果保存在独立rules/head/request/receipt中，不改写记分事件；READY的有效行政来源必须核scoring_states的当前source_version、暂停时钟及未确认状态。

专业统计与阵容/权威时间在原追加记分及确认快照内扩展，未采集字段不补0；离线意向保留原命令ID、顺序、lease fence及回执。公开档案、招募/海报、赞助和账本分别保留当前授权及不可变版本/发布来源，不互相替代授权。local_resource_reservations与既有排赛/球员预约共享日历守卫，DB到期与取消释放规则不由客户端时间决定。

账号操作只保存token哈希、单次消费/取消墓碑及加密mail envelope，密码重置以users.credential_reset_at撤销旧会话；同账号新有效码可取消未知旧编号，但不延长旧码或授权过期码执行账号动作。经费公示记录线下账务及追加冲正，不作为支付余额。所有新表均进入最小权限、真实非空重启/完整恢复和恢复后授权隔离清单；不修改已成功执行的旧Migration来修补测试。

## C03迁移与生命周期（已合并，隔离CI执行，生产未执行）

010_c03_event_history.sql仅给既有public_event_publications新增purpose（LIVE/HISTORY、非空缺省LIVE），并将其纳入不可变字段守卫；不改001–009，不增加表，仍40表。旧公开记录保留LIVE语义，不能因升级自动成为历史授权。runtime仍只可INSERT用途，不取得purpose UPDATE权；就绪与恢复精确迁移集合已扩为10（隔离验收）。010 SHA256 `a4c2394280bee34e89b9b8add078f0a92fc3ab0908859625cda16ed8cb984433`，PR11/CI39941294620已验证10Migration与40表实际重启和完整恢复；编写与隔离执行证据见[C03交接](handoffs/C03.md)。

复用events已有COMPLETED/ARCHIVED状态和当前正式赛程/确认/排名源。COMPLETE与REOPEN原子更新event.version、审计并撤销旧publication；ARCHIVE不删除数据。显式HISTORY才允许闭赛公开读取，独立OBS授权不复用此用途。私有球员榜只投影当前有效个人确认与冻结名单，一次statement snapshot，不建立汇总表或复制比分/时钟。旧007 FINAL升级缺口仍单列，不能用当前schema闭赛/恢复测试冒充历史升级。

## C02迁移（已合并，隔离CI已执行，生产未执行）

2026-10-23，PR10已合并main e5d4782，最终CI39919192641通过，尚未部署生产。008给原scoring_states/result_confirmations增加collection_mode与nullable player_stats，旧行缺省TEAM_ONLY/null；沿原准备事件锁模式、原事件派生个人投影、原确认保存快照，状态守卫禁止更换模式。名单来源复用published_matches固定的报名revision，不建第二套名单/比分/时钟。009给users增加nullable唯一login_name与ASCII规范约束，保留ID、邮箱、角色；两次迁移不增加业务表，仍为40表，001–007不改。

runtime仅为scoring_states追加player_stats的UPDATE白名单；不给collection_mode UPDATE，也不给users.login_name/password_hash UPDATE。离线账号维护使用受控维护角色及不可登录系统审计主体，用户级advisory协议与原session→user锁序共同保证会话撤销和登录串行性，见[维护说明](ACCOUNT_MAINTENANCE.md)。未在正式库执行；真实隔离PG升级/约束/并发、40表重启及完整备份恢复已通过。旧schema升级夹具只含旧用户/凭据，不等于007已落库FINAL完整升级，部署前仍须核验真实旧库副本。

设计版本：0.1；更新：2026-10-22；状态：P02至P06-A的已交付子卡已整合main，DONE / MAIN。001→006在隔离PG18.6执行／复跑checksum并通过39表实际重启；保险附件未建表，无生产执行。完整P05的可靠离线／专业统计、完整P06媒体／直播等仍为后续范围，原生OBS／CEF及备份恢复未验。

## 1. 通用约束

P02主键使用服务端生成的UUID；后续实体沿用不透明ID原则。时间戳使用 UTC，赛事保留 IANA `timezone` 用于展示和排期；`startDate/endDate` 是该时区的赛事日期，场次实际开球使用带时区时间戳。机构范围的业务资源含 `orgId`、创建/更新时间及必要的 `version`；User 等全局身份实体不强行绑定唯一机构。数据库不以本地日期字符串排序代替真实开球时间。

带机构范围的父表建立 `UNIQUE(orgId,id)`；子表用复合外键引用同机构父资源。名单、场次、事件还校验相同赛事归属。业务标识及唯一性以归一化结果约束，不只依赖前端查重。

## 2. 核心实体

| 实体                                  | 主要字段与关系                                                                                                           | 关键约束                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| User                                  | id、登录主体引用、公开昵称                                                                                               | 登录主体唯一；私密身份资料独立保护                                                             |
| Organization                          | id、name、status                                                                                                         | 禁用机构阻止新增写入，保留授权读取策略                                                         |
| OrganizationMembership                | orgId、userId、role、status                                                                                              | 同机构同用户唯一；权限变更审计                                                                 |
| EventStaff                            | orgId、eventId、userId、role、status                                                                                     | 已实现的赛事工作人员授权；场次授权由独立MatchStaff承担                                         |
| MatchStaff                            | orgId、eventId、matchId、userId、role、status                                                                            | P05-A显式SCORER／RESULT_REVIEWER，ACTIVE分配要求有效机构成员；不要求额外EventStaff             |
| EventSeries                           | orgId、name、品牌引用                                                                                                    | 可选的长期赛事品牌，关联多届赛事；P01 不建立                                                   |
| Event                                 | orgId、可选seriesId/seasonLabel/editionLabel、name、startDate、endDate、timezone、可空venueName、format、status、version | 日期有序；format 为约定枚举；创建状态 DRAFT；P01不要求设置系列                                 |
| Division / CompetitionStage / Group   | orgId、eventId；组别/阶段/小组名称、顺序、规则版本与晋级来源                                                             | P04按需新增；阶段与小组均属于同一届赛事，不能将所有小组积分混算                                |
| EventRuleset                          | orgId、eventId、version、rules、lockedAt                                                                                 | 同赛事版本唯一；使用后的版本不可覆盖                                                           |
| Team / TeamMember                     | orgId、name、badge；teamId、可选userId、展示资料                                                                         | 长期球队档案；证件不放公开成员字段                                                             |
| TeamAccessGrant                       | orgId、teamId、userId、role、status、可选expiresAt                                                                       | 领队/球队管理授权独立于机构成员；授权撤销后不能继续操作本队报名                                |
| ParticipantLink / Invitation          | orgId、entryPlayerId、userId、status；邀请用途、受邀对象、资源范围、令牌hash、expiresAt、acceptedAt                      | 本人身份绑定可追溯；邀请限期且一次接受，不能靠客户端userId认领他人资料；接受不授予工作人员身份 |
| EventEntry                            | orgId、eventId、teamId、teamNameSnapshot、status、version                                                                | 同赛事同球队唯一；外部导入先生成本机构授权档案/快照                                            |
| EntryPlayer                           | orgId、eventId、entryId、memberId、nameSnapshot、jerseyNo、eligibilityStatus                                             | 本届名单独立保存；号码在当前有效报名名单内唯一                                                 |
| PrivateParticipantData                | orgId、entryPlayerId、受保护身份/联系信息引用                                                                            | 单独权限；不作为公开球员 DTO 的默认关系                                                        |
| InsuranceEvidence                     | orgId、entryPlayerId、objectKey、source、reviewStatus、reviewerId                                                        | 凭证文件私有；EXTERNAL 仅表示来源，不等于审核通过                                              |
| Venue / Court                         | orgId、name、位置说明；venueId、courtName                                                                                | 场地冲突以 courtId 和时间区间判断                                                              |
| Draw / ScheduleRevision               | orgId、eventId、rulesetVersion、输入/随机结果快照、version、发布人                                                       | 重抽说明原因；发布版本不可原地改写                                                             |
| Match                                 | orgId、eventId、scheduleRevisionId、适用的divisionId/stageId/groupId、双方entryId、courtId、startsAt、status、version    | 双方不同且属于本赛事；阶段/小组归属一致；锁定使用的规则版本                                    |
| MatchRoster                           | orgId、matchId、entryPlayerId、比赛名单快照                                                                              | 只能来自批准报名名单；赛后人员变动不改历史                                                     |
| MatchEvent                            | orgId、matchId、seq、commandId、type、payload、actorId、captureTime、serverTime、correctionOf                            | `(matchId,seq)`唯一；事件追加；修正引用同场合法事件                                            |
| MatchProjection / ClockState          | orgId、matchId、比分/统计、sourceVersion；计时锚点                                                                       | 一场一份当前投影；记录采集模式及未采集字段                                                     |
| ScorekeeperLease                      | orgId、matchId、holderId、deviceId、expiresAt、fencingToken                                                              | 一场一个有效主写租约；转移递增栅栏版本                                                         |
| ResultConfirmation                    | orgId、matchId、matchVersion、确认人、结果快照                                                                           | 每个确认版本不可变；重开保留旧确认历史                                                         |
| StandingProjection                    | orgId、eventId、适用的divisionId/stageId/groupId、rulesetVersion、sourceResultVersion、排名数据                          | 仅基于已确认赛果；重算不能混入旧版本和不同组别/小组                                            |
| IdempotencyRecord / AuditLog / Outbox | 请求作用域及hash/结果；操作者及变更引用；已提交待投递事件                                                                | 与相关业务事务一致；重放仍需重新鉴权                                                           |

BroadcastSession、MediaAnchor、SponsorPlacement、Entitlement和UsageLedger在对应阶段新增；P06-A已交付的OverlayGrant及session表见第11节，已在隔离CI执行。视频存引用与时长/用量，不存二进制；软件权益与视频用量分账。支付、退款、保险交易模型尚未定稿，不把报名审核状态当作支付状态。

P06 的扩展对象至少定义：直播会话所属机构/比赛/云端流引用及状态；媒体锚点所属录制分段、比赛版本、媒体偏移及误差；包装授权的比赛/字段范围、有效期及撤销状态；赞助素材的所属机构、展示位、适用赛事、排期和批准记录；权益的计量单位、限额、有效期与来源；用量台账的业务来源、数量及唯一去重键。额度与计量更正使用追加记录，不能靠覆盖历史用量解决。具体表结构和服务订单、支付状态在专项任务中定稿，不在 P01预建。

## 3. 规则快照

`format` 当前约束为 `ROUND_ROBIN`、`GROUP_KNOCKOUT`、`SINGLE_ELIMINATION`、`DOUBLE_ROUND_ROBIN`，与共享EventFormat及Migration026的events_format_check一致。单循环/双循环分别使用RR_CIRCLE_V1/DRR_CIRCLE_V1；双循环共n(n−1)场并主客互换。季军赛由排赛policy显式thirdPlaceMatch:true控制，不是独立EventFormat，也不自动改变旧赛事。报名、记分、排名和晋级仍按各自版本来源及锁定规则核验。实际赛事逐项设置并确认，不全平台固定“8队16场”“19:30/20:15”或某届户籍条件。

排赛规则区分硬约束与可提示的偏好；系统无解时输出冲突证据及可放宽项，不偷偷放宽。手动调赛生成新版本并重跑校验；已开赛或已确认场次不能被普通排赛覆盖。

## 4. 状态机与守卫

- **赛事**：`DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → SCHEDULED → RUNNING → COMPLETED → ARCHIVED`；允许受控 `CANCELLED`。P01 仅创建/编辑 DRAFT。开放报名、发布赛程、结束和归档分阶段实施；COMPLETED 要求必要比赛已确认或有明确取消/弃权处置，不仅是比分已填。
- **报名**：`DRAFT → SUBMITTED → APPROVED / CHANGES_REQUESTED / REJECTED`；CHANGES_REQUESTED 补齐后重新提交；未锁定前可按规则 WITHDRAWN。审批操作者、理由和版本需保留。
- **保险凭证**：`PENDING → APPROVED / REJECTED`，规则不要求保险时可标 `NOT_REQUIRED`。凭证批准只表示本赛事审核结论，不保证理赔或替代承保方判断。
- **比赛**：`SCHEDULED → READY → LIVE → PENDING_CONFIRMATION → FINAL`；另有 `POSTPONED / CANCELLED`。不能从 LIVE 直接成为正式赛果。READY 校验名单、规则及工作人员；结束计分进入待确认。FINAL 更正需有权限的重开命令回到 PENDING_CONFIRMATION，该状态只允许受控更正及确认，不继续正常实时计分。P05-B已验收榜单只消费当前有效确认；下游晋级未实现。未来若更正影响已排定或已开赛的下游晋级场次，应阻断自动改写并交赛事管理员处置。延期恢复、弃权、争议处置必须记录原因，不直接删除比赛。
- **赛程版本**：P04-A只有当前`DRAFT → PUBLISHED`，重抽把旧DRAFT变为SUPERSEDED并创建新DRAFT；已发布版本不能变为SUPERSEDED或被替换。发布校验冻结球队、时间、场地及规则来源；后续发布后改期另开有恢复方案的任务。

删除已参赛球队、已使用规则或已开赛场次应拒绝或归档，不能级联删除历史。个人数据保留、注销和匿名化策略在真实资料上线前确定，业务历史与敏感原文分别处理。

## 5. 必要索引与验证

优先建立成员 `(orgId,userId,status)`、赛事 `(orgId,status,startDate)`、报名 `(orgId,eventId,status)`、比赛 `(orgId,eventId,startsAt)`、场地时间检索及事件 `(matchId,seq)`。幂等唯一键包含机构、操作者、命令作用域及幂等键；只存业务所需的最小响应。P04-A已用GiST排他约束、机构mutex及真实并发用例验证本机构Court/Team占用；P05-A的同场连续seq、幂等唯一键、永久fence及projection版本约束见第9节。

必须验证跨租户外键、外部参与者资源授权及撤销、邀请冒领/重放/过期、重复报名/号码、规则锁定、旧版本写入、租约转移、重复事件/补偿、重开赛果与榜单重算。P02至P05-B适用范围已执行，最终CI106项独立PG通过；001→005执行／复跑及实际重启证据见下文与[TESTING](TESTING.md)。005三表已在隔离CI建立并保留，规划实体不因此成为已建表。

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

| 新增表                | 责任与关键约束                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| courts                | org共享稳定场地，规范化名称唯一、ACTIVE/DISABLED及CAS版本                                                                    |
| org_schedule_mutex    | org_id主键；写场地及发布同事务INSERT ON CONFLICT后FOR UPDATE，覆盖既有和新机构                                               |
| schedule_revisions    | freeze/source/policy/seed/hash/轮次及顺序、DRAFT/SUPERSEDED/PUBLISHED、版本和重抽历史；来源始终不可改                        |
| schedule_fixtures     | 主键(org_id,revision_id,fixture_key)，双方entry/team及轮次固定；仅DRAFT可改场地和时间分配                                    |
| schedule_publications | event唯一发布，绑定revision及publicationHash；禁止更新、删除或发布后追加篡改                                                 |
| published_matches     | 固定双方entry/team/name/rosterRevision、courtName、时间及来源引用；初始SCHEDULED/version1，P05-A受控记分只更新status/version |
| court_reservations    | 每场一条，主键(org_id,match_id)，正式场地及半开时间占用                                                                      |
| team_reservations     | 每场每队一条，主键(org_id,match_id,team_id)，按长期canonical Team防跨赛事重叠                                                |

同时增加events.current_schedule_revision_id及registration_freezes复合唯一键。真实复合FK约束org/event/revision/entry/team/roster来源；每场一Court、两Team，`btree_gist`与`tstzrange(starts_at,ends_at,'[)')`GiST排他约束防同机构同资源重叠。发布后来源、fixtures、publication、reservations不可更新、删除或追加；match计划事实不可变；P05-A已通过受控commands更新status/version，以独立状态实体保存比分及clock，不能借status/version改计划。

发布及Court写按session/user→org→membership→org_schedule_mutex→event（如适用）→revision→Court顺序锁定，不升级org SHARE。发布从服务器freeze与seed重算对阵和占用；同事务写publication→matches→每场1court/2team预约→revision PUBLISHED→event SCHEDULED/version→audit。revision完整性触发器及deferred提交约束阻止半份发布。双赛事争抢Court／同Team、缺mutex行首次并发、Court停用竞态、机构隔离及审计失败整体回滚均经真实PG验证。

本卡只支持2–32队单回合ROUND_ROBIN、显式占用／休息／本地日期间隔及时间窗口、手工分配和一次发布。重抽新建来源、旧稿SUPERSEDED只读；没有自动排时、淘汰／分组、改期或释放预约。机构内canonical Court/Team协调不等于跨机构物理场地共享；本节只验收P04-A；有限正式排名／公开观赛已由第10节P05-B交付，完整P04及P06仍未完成。

## 9. P05-A记分持久化（DONE / MAIN，隔离测试库已执行）

[PR #5](https://github.com/xyq-dev/small-city-basketball/pull/5)合并main `3c0bf8408b181d6e96c00b348d7cebb7bad54aef`；验收代码 `1cb8e41400de4e497580e98c7eb77d6a7a02e079`、tree `9f23899a9e118304db2749b8505d04c5468c5dfe` 经[CI39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)全部成功。`004_p05_scoring.sql` SHA-256为 `ebf454ab7e5bcb86e9453bab0e9783d792f5c0755fd7621878aa96a3c997ab83`。001→002→003→004已在隔离PostgreSQL18.6执行及复跑校验，88项独立PG通过（P02 20＋P03-A 24＋P04-A 24＋P05-A 20）；真实PG重启保留运行中clock锚点、已释放lease及fence、追加事件／receipt、重开后两份确认，以及原授权／报名／排赛／预约／审计／checksum。没有生产数据库或生产执行。

| 新增表               | 主要字段与提交约束                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| scoring_rulesets     | id、org/event、version及显式节数／节长／允许分值／平分与加时规则；同赛事版本唯一，规则不可UPDATE/DELETE                                                                                          |
| match_staff          | 主键(org_id,match_id,user_id)，SCORER／RESULT_REVIEWER及ACTIVE／DISABLED；复合FK绑定同机构成员与正式比赛，不把全局角色当作场次授权                                                               |
| scoring_states       | 主键(org_id,match_id)，绑定ruleset、source_version、last_event_seq、双方score/fouls/timeouts、period_stats、clock及最新确认指针／requires_reconfirmation；绑定来源不可替换，版本不回退           |
| scoring_leases       | 主键(org_id,match_id)，holder_user_id／holder_session_id／client_instance_id／lease_id、int64 fencing_token和expires_at；永久计数，不DELETE；换绑定需新leaseId及更高fence，触发器核对session归属 |
| scoring_commands     | 主键(org_id,actor_id,match_id,command_id)，规范request_hash、type、applied_version、首末event seq、accepted_at；不可变最小收据，不保存控制凭据或整份历史workbench                                |
| scoring_events       | id、同场连续seq、type/payload、actor/command、captured_at/server_time、target_event_id；同场目标FK、STAT_VOIDED目标唯一、只追加；receipt关联延迟到commit验证                                     |
| result_confirmations | 不可变id、org/event/match、确认人、规则id/version、确认前source_match_version／last_event_seq、双方基础统计及period_stats、confirmed_at；同场来源版本唯一                                        |

events增加current_scoring_ruleset_id／locked_scoring_ruleset_id复合FK；首次READY后锁定指针永久不清除或替换，current必须等于locked。规则整数范围与非空不重复分值子集有CHECK；projection基础计数非负、时钟有界，所有业务引用按org/event/match组合校验。`scoring_states.source_version`必须与`published_matches.version`同事务提交，由两个表上的deferred constraint trigger验证；因此人员变更在已有projection时也同步版本，不改变比分或clockVersion。003的正式计划不可变触发器保持，只有match.status/version允许受控更新。

命令在match UPDATE锁下验证CAS、追加事件并重放统计，再更新match和projection、写receipt及audit；审计或约束失败整体回滚。PREPARE/START还校验Event CAS，并从入口取得Event UPDATE，不从SHARE升级；首次START把Event推进RUNNING，普通命令取Event SHARE。会话／用户→org→membership→event→eventStaff→match→matchStaff→lease为基础锁序；工作人员变更先锁target user/membership，确认在match后按Team ID排序取UPDATE，再查双方当前ACTIVE领队grant，防止新领队穿过负向检查。历史实际记分／时钟／开始／结束／更正者不可确认，撤销统计、换角色或租约都不清除历史。

ACTIVE分配要求target当前用户及成员有效；DISABLED只UPDATE已有本org/match分配，可在机构成员或用户已停用后清理，绝不创建空停用记录。目标UUID归一后参与assignment／holder比较，停用原holder使lease立即过期；当前manager权限、CAS、projection版本及审计仍同事务。该修正已有真实PG回归，并覆盖未知／跨机构／未分配目标拒绝及失败指纹不变。

租约使用锁后DB时间、TTL30秒、心跳10秒，fence为十进制int64字符串对外返回。释放保留绑定和fence，仅更新expires_at；过期续约／释放不会影响继任者。租约操作不计作历史实际记分，也不递增match.version。clock保存period、原始remaining_ms、clock_running、anchor_server_time和clock_version；响应不预先扣减再沿旧锚点扣第二次，客户端据serverTime插值。到0不自动暂停，释放或过期不改clock，实际PG重启后沿同一锚点继续显示。

STAT_RECORDED保存kind/side/value/period及可选reason；更正用STAT_VOIDED关联同场仍有效事件，替换原子追加VOID＋新STAT并保留kind/period。原统计和确认历史永不覆盖。确认前按全部事件重放并核验projection，结果source_match_version及last_event_seq取确认前的版本／序列；确认命令自身新增生命周期event与appliedVersion。FINAL后合法staff调整可增加当前match/sourceVersion而不使既有统计确认失效，不能将两种版本直接判等。

重开仅FINAL→PENDING_CONFIRMATION，保留旧latest确认并设置requires_reconfirmation；修正后重新确认新增结果，不恢复LIVE。OVERTIME平分拒绝结束／确认，待确认修正产生平分时也不伪造正式结果，本卡无恢复LIVE补加时流程。Event不自动COMPLETED；已交付的正式排名／公开读身份模型见第10节，SSE/outbox、可靠离线、专业球员统计、延期／弃权／争议、晋级及OBS仍待后续任务。

私有ScoreSnapshot白名单不含lease/session/control或身份／保险材料；工作人员及受控lease摘要仅在Workbench。P05-A没有匿名读或OverlayGrant，后续公开／OBS须独立授权并使用有限投影，不能直接序列化本节实体。精确HTTP行为见[API契约第8节](API_CONTRACTS.md)，验收与审查状态见[TESTING](TESTING.md)。

## 10. P05-B排名与公开身份模型（DONE / MAIN）

`apps/api/migrations/005_p05_standings_public.sql` SHA-256保持`e6c786b60b2143409b192c47398f951861be0964ac954ea5ebfd5cd2af5ac221`。独立静态CLEAR后，已随PR #6合并main `bd38318fdfdbaeb9cfee1033c0d025e79c6cc797`。[最终CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)按001→005隔离执行／复跑checksum，106项独立PG及实际PG18.6重启通过，指纹覆盖36个migration应用表与schema_migrations共37表，含本卡三表、规则锁、有效／撤销公开身份、全量映射和sourceHash；12Mock＋12真实API官方浏览器通过。首CI429、第二轮取消、第三轮负向checker SQL绑定失败及最终修复均保留[TESTING](TESTING.md)。无生产数据库或生产执行。

| 新表                      | 主键、引用与约束                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| standings_rulesets        | UUID id；org_id/event_id/version唯一，复合FK指向本届Event；algorithm_version固定RR_STANDINGS_V1，三种积分各0–1000，tiebreakers允许空或三个受支持项的不重复有序子集；规则禁止UPDATE/DELETE                                                                                                         |
| public_event_publications | UUID id及org/event/schedule_publication_id/ruleset_id；复合FK绑定同届正式赛程和排名规则。public_event_id为全历史唯一43字符公开身份；team_keys为entryId→22字符随机公开teamKey映射，仅服务端内部保存。created_by/at、created_xid、revoked_by/at留历史；同event仅一条revoked_at为空的有效publication |
| public_match_links        | 主键(publication_id,match_id)；org/event/publication/schedule组合FK指向公开publication，org/event/match及org/schedule_publication/match两条复合FK共同绑定本届同一次正式赛程的比赛；public_match_id全历史唯一43字符，禁止UPDATE/DELETE                                                             |

events增加current_standings_ruleset_id及locked_standings_ruleset_id，同org/event复合FK引用规则；locked一旦非null就不能清除／替换，CHECK要求current等于locked。保存追加新草稿并CAS更新current，单独发布当前规则后永久锁定；首次READY锁的是P05-A记分规则，两类指针不能混用。积分和排序策略不改变原记分／报名／正式计划。

公开publication插入时必须有效、created_xid等于`pg_current_xact_id()`。仅允许一次有效→撤销，编码为revoked_at/revoked_by从同时null变为同时非null；其他字段不可变，撤销后任何更新／删除／回活均拒绝。created_xid为内部事务标记，不是公开ID或HTTP字段。mapping插入要求publication的created_xid仍为本事务且未撤销，不能在之后事务补链。

deferred提交守卫读取不可变P04 revision.source.entries：要求2–32个不同entry，team_keys精确覆盖全部entry且值格式正确／本次不重复；官方场数须等于n×(n−1)/2，公开links数量等于全部官方场次。结合主键／复合FK和不可变保护，初始事务不能漏场、重复绑定、串赛事或追加另一正式赛程的比赛。索引包括每event最多一条有效发布的部分唯一索引、按event/created_at/id查询历史；两类public ID的唯一约束覆盖已撤销历史，旧ID不得复用。公开随机性由服务端CSPRNG生成，不把DB字符格式校验误称为熵证明。

私有操作锁序为session/user→org/member→Event UPDATE→规则/publication/映射；public ENABLE同事务写publication、全部links、Event版本和audit，DISABLE同事务撤销并写版本／audit，COMMIT约束失败整体回滚。匿名解析公开身份后按org SHARE→Event SHARE→publication SHARE重查有效性，与P05-A Event SHARE记分及Event UPDATE管理兼容，不占排赛mutex。DISABLE响应跳过榜单计算返回standings:null，损坏FINAL不能阻止撤销。规则锁、动作授权和审计由应用事务执行，DDL不替代身份鉴权。

排名只按同一条批量SQL的全部正式match及LEFT JOIN的state/current confirmation/最后event/receipt/scoring rules计算，无逐场N+1或缓存worker。FINAL必须满足当前state版本、确认指针／规则、完整总数及按节合计、最后CONFIRM_RESULT与receipt来源证明；还必须暂停且剩余0、已完成常规节。独立审查发现的终局三条件缺口已修复并补源码反例。staff合法变更增加match/state版本但不改事件／统计，所以不以confirmation.source_match_version等于当前版本判定，也不把staff时间或当前运行版本加入sourceHash。重开退出榜单，重确认只消费最新一份；坏FINAL整体RESULT_SOURCE_INVALID，不静默略过。

无确认时全队rank=null；有确认后积分及显式排序项均相同则共享1,1,3，冻结来源顺序只稳定显示。公开投影只取随机公开键和冻结展示名、官方时间场地、有限基础统计／规则及raw clock；未准备值为null，不伪造已采集0。嵌套白名单和游标不泄露内部org/event/match/entry/team/user ID、roster、工作人员、确认人、事件／receipt或控制凭据。本节P05-B不含OverlayGrant；已交付P06-A模型见第11节。没有公开SSE、可靠离线、微信或生产发布，精确DTO见[API契约第9节](API_CONTRACTS.md)。

## 11. P06-A包装授权模型（DONE / MAIN，隔离库已执行）

P06-A已通过[PR #7](https://github.com/xyq-dev/small-city-basketball/pull/7)合并main `f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，DONE / MAIN；最终验收source `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`、tree `2a719b4b3e8fd4f67996144c687f5bbb72902519`。 `apps/api/migrations/006_p06_overlay.sql` SHA-256保持`94a54d6ae997774fd9b511dd39f5d4e1596b71c97384f2162e5c1dd8a7a39be6`。[最终CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)全部成功：372项源码（admin171／API201）、123项独立PG、001→006隔离执行／复跑checksum、真实PG18.6重启与39表完整指纹、12Mock及桌面7＋手机7真实API官方Chromium151.0.7922.34浏览器。正常及故意失败流程只清本次owned子库，控制库保留。 38个migration应用表及schema_migrations共39表，包含Grant／session、活跃／撤销身份、精确截止和原业务。001–005未修改；没有生产数据库、生产Migration或备份恢复证据。

| 006已在隔离CI建立的表 | 主键、归属与约束                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| overlay_grants        | UUID id主键；org_id/event_id/match_id复合FK指向同机构、同赛事正式published_matches；overlay_id为全历史唯一43字符身份，secret_hash为唯一64字符SHA-256十六进制；固定SCOREBAR_1080P_V1、issuer_id→users、created_at/expires_at、version、revoked_at/revocation_reason。另有(org,event,match,id,expires_at)唯一键供session精确引用 |
| overlay_sessions      | UUID id主键；org/event/match复合FK指向正式场次，(org,event,match,grant_id,expires_at)复合FK引用Grant，截止必须完全相等，不能JS Date截断微秒后重存。token_hash全局唯一，created_at/expires_at有限且有序；UPDATE／DELETE一律拒绝                                                                                                 |

Grant创建固定version=1且未撤销；仅允许一次version1→2并填写撤销时间／理由。除version、revoked_at、revocation_reason外全部字段不可变，删除、重复撤销、回活、更改secret／身份／创建者／TTL均拒绝。expires_at必须晚于created_at且不超过10080分钟；HTTP另要求明确整数1–10080分钟。索引(org_id,match_id) WHERE revoked_at IS NULL保证每场只有一条未撤销记录，包含已过期记录；到期本身不更新DB。ISSUE遇已过期当前记录须同事务以SUPERSEDED_AFTER_EXPIRY撤销后新建；ROTATE撤销当前并新建，REVOKE只关闭当前，历史不删除／复用。历史索引按org/event/match及created_at DESC、overlay_id DESC，管理仅返回最近20条已撤销记录与truncated。

overlayId、bootstrap secret及专用session token都由服务端随机256bit生成，DB只保存后两者hash；DDL格式校验不是随机性证明。secret可在期限内重复bootstrap，不是一次消费；正确secret先核验，随后才考虑复用Cookie。专用session不继承users session，也不能延长Grant期限；新session用INSERT SELECT直接复制PG原截止，有效既有session复用不增行、不更新访问时间。scb.sid、排名规则和public publication均不构成源授权。

应用管理锁序actor/session→org/member→Event UPDATE→eventstaff→Grant；当前资格、Event CAS、ROTATE／REVOKE的Grant CAS、Event.version递增及audit同事务，不改Match.version。独立读解析overlayId后按org SHARE→Event SHARE→Grant SHARE→session SHARE重查机构、撤销及锁后DB截止。独立复读发现session INSERT的正式match FK可能等待记分锁；已补INSERT后MATERIALIZED clock_timestamp精确判Grant/session共同期限，若跨截止则404并回滚新session，不出Cookie。该补丁静态CLEAR，真实FK等待跨截止回归通过，404整事务回滚且没有新session或Cookie残留。

DDL保证归属、固定截止及不可变历史；实际STREAMER／当前成员授权、secret校验、来源投影、审计和等锁后时间由应用守卫证明。单场来源SQL复用P05-B有效FINAL证明，合法staff升版本不使结果失效。私有坏预览保留元数据和freshEvent CAS，公开包装快照仍409。详见[API第10节](API_CONTRACTS.md)及[TESTING](TESTING.md)；P06媒体、视频、云推流及权益账本没有因此建表或完成。

### P06-A两轮成功CI与恢复来源

首CI39756976748在远端source7ba9d01bb46d8c4b7a5ce72081aef50719d05539（tree52f2681a727b9a5ea4944c6019a8f0eaa0cda8cd）也全部成功；后续15份Markdown只修可达恢复点及记录，没有业务或Migration变化。最终CI再次全部成功后合并PR7。首head文档P2已resolved／outdated，最终addeb自动CodeReview completed且无finding（comment6337630278），security未运行。恢复使用上述main合并点或最终远端source；本地19d5801仅作历史来源，不是fresh checkout恢复入口。两轮run／job与边界见[TESTING](TESTING.md)。原生OBS／CEF、生产与备份恢复仍未验收。

## 12. P07-A角色权限与恢复隔离（DONE / MAIN，PR8）

没有新增/修改业务Migration，001–006及39张表结构保持。DB身份为初始化scb_admin、DDL owner scb_migrator、受限scb_runtime与只读scb_backup；表/列权限由`packages/contracts/runtime-privileges.json`显式声明，运行就绪精确核验。

完整restore先CREATE全新scb_restore_*并记录共享数据库COMMENT内nonce及OID；归属门用shobj_description读取pg_shdescription，名称/OID/nonce均须匹配，不能采用已有库。COPY/DDL按完整pg_restore正常顺序恢复并重应用manifest，不在已迁移库data-only覆盖，也不禁用历史守卫。

quarantine使用新DISABLED系统User，无机构成员权及可验证密码；不伪装原owner。撤销旧private sessions、未消费邀请和未撤销public publication；overlay仅v1未撤销→v2/非空理由，不触碰既有撤销历史或不可变overlay_sessions；只提前到期已取得且仍有效lease，保留身份/fence，空lease保持NULL/fence0。组织全部DISABLED、相关Event版本递增，RESTORE_QUARANTINE审计原子保存。第一阶段完整一致与第二阶段预期隔离变化分别验证，不能声称隔离后全库指纹仍相等或fence超过未知备份后最大值。

## P04-B当前正式安排与不可变改期历史（DONE / MAIN）

新增007，001–006不改。`published_matches`保持唯一当前正式计划；原schedule_publications/revisions/fixtures及hash仍不可变，初次发布来源不被改期覆盖。新增第40表`match_reschedules`保存当前事务xid8、old/new Court名称与起止时间、from/to Event及Match版本、理由、created_by与created_at；同match目标版本唯一，tenant/event/match及Court复合FK防串scope，历史只能INSERT不能改删。

数据库只允许同事务精确history证明的比赛计划与预约必要列更新，状态/对阵/来源身份不能借改期变化。history commit守卫核对最终match/event版本及计划、恰一Court与双方两Team预约，现有排他与scoring source_version提交约束保持。策略窗口/日期/休息由锁保护下的现有validateSchedule校验，不在SQL复制第二套算法。无proof、孤立或不一致history、删预约/历史须拒绝；审计及任何阶段失败全部回滚。

runtime新增history SELECT/INSERT与match/court/team预约必要列UPDATE，backup仍只读，未新增高权或SECURITY DEFINER入口。40表与7Migration精确就绪/恢复指纹随本卡更新。007已在隔离CI实际执行，40表实际重启及完整dump恢复通过，证据见[交接](handoffs/P04-B.md)；生产执行为0。

## C04 单淘汰推进凭证

2026-10-23，011_c04_knockout.sql已在隔离CI执行，证据见[C04](tasks/C04.md)，无生产执行。旧001–010字节不变。新增第41表knockout_round_publications：唯一org/event/round，复合FK引用原publication/revision，当前transaction_id xid8、from/to event版本、来源hash、上一轮原match/confirmation身份及胜方、全轮计划fixtures、原因/作者/时间。无新的比分或计时状态；正式场次仍published_matches，轮空不建比赛。

SE首轮比赛数n−nextPow2(n)/2，后轮只能精确同事务凭证追加全部fixture/match/1court+2team预约，deferred guard要求事件增版与完整全轮一并提交；proof禁止改删，runtime仅SELECT/INSERT。原RR发布与007改期不可变语义保持。sources.matchVersion是确认生效固定版本，允许后续安全人员维护提高当前比赛版本，确认ID/原结果仍严格核验。011放宽public ruleset_id为空仅限明确SE；RR仍必须锁定原排名规则，公开links仍只能随初次授权创建、精确覆盖当时全部正式比赛。

就绪、最小ACL、backup/restore与精确指纹同步41表/11Migration。签位与最终名次是原冻结来源+seed+正式比赛+当前确认+不可变推进凭证的读投影。完赛要求恰好n−1比赛及完整有效树；无三四名赛、半决赛同轮败者共享名次。

## C23 私有本人材料（Migration024已编写并在隔离CI执行，生产未执行）

`event_rulesets.require_participant_materials` 默认false，旧锁定规则不自动启用。新 `participant_materials` 按机构/赛事/entry/member关联当前本人binding、key-id、当前revision/status/version和独立宣传许可；`participant_material_revisions` 以不可变revision保存规则/名单/号码/实际terms_version、经过完整解码重编码的照片与外部保单事实，私有文字及文件全部进入资源AAD绑定的AES-GCM密文。身份查重为专用HMAC，当前有效reservation的账号/身份同届唯一；历史无效占用按event锁释放，旧回执不复活。

原clientRequestId、请求patch指纹和旧revision永久保留为回执墓碑，私有密文仅在赛事归档/取消且结束超过90日、无legal_hold时由人工维护清除；没有自动任务。清除不得修改既有revision元数据或冻结参赛事实。冻结snapshot只新增材料revision引用，不包含证件/照片/保单。宣传撤回作用于head的独立权限事实，不撤销参赛审核。当前83表／24迁移，001–023未修改；运行权限、readiness、重启/恢复精确清单已同步，执行证据以任务卡为准。


### E08 042 成年资料处理事实

新增append-only `youth_adult_data_consents`，绑定actor及performed_by、org/event/team/entry/member/binding、当前material/revision、独立age_evidence_qualification、policy/terms与递增version；decision为CONSENT/WITHDRAW，cause为SELF/ACCOUNT_CLOSURE/RESTORE_QUARANTINE。不保存生日或身份明文，runtime仅SELECT/INSERT；本人同意必须performed_by=actor。注销与恢复隔离追加WITHDRAW，保留旧事实。年龄证据只授权处理资料，不代替当前参赛、保险、照片或公开资格。042尚待隔离数据库首次执行，036—041冻结校验保持。
