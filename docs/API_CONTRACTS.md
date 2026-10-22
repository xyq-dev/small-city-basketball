# API 契约

目标契约：v0.2；更新：2026-10-22。P01、P02、P03-A、P04-A、P05-A、P05-B及P06-A均已整合main，DONE / MAIN。P06-A已通过[PR #7](https://github.com/xyq-dev/small-city-basketball/pull/7)合并main `f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，DONE / MAIN；最终验收source `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`、tree `2a719b4b3e8fd4f67996144c687f5bbb72902519`。[最终CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)全部成功：372项源码（admin171／API201）、123项独立PG、001→006隔离执行／复跑checksum、真实PG18.6重启与39表完整指纹、12Mock及桌面7＋手机7真实API官方Chromium151.0.7922.34浏览器。正常及故意失败流程只清本次owned子库，控制库保留。 身份、报名冻结、排赛、记分、排名／公开观赛及独立只读包装的实际合同见第5–10节；历史证据见[TESTING](TESTING.md)。完整P03/P04/P05/P06仍有文件／小程序、其他赛制／改期、可靠离线／专业统计及媒体等后续范围。原生OBS／CEF、生产及备份恢复未验收。

## 1. 通用约定

- 私有路由前缀 `/v1/orgs/{orgId}`，每次验证登录身份、资源归属及具体动作权限。工作人员还验证机构成员状态和赛事分配；领队/球员验证球队授权、本人绑定或有效邀请，不要求成为机构工作人员。路径 orgId 不构成授权。未知或跨租户资源返回 404；已可见资源但无动作权限返回 403。
- JSON 成功响应 `{data, meta:{requestId}}`；列表为 `{data:[],meta:{requestId,nextCursor}}`。游标分页默认 `limit=20`、最大100；允许的筛选/排序由各路由白名单限定，不能接收任意 SQL 字段。
- 错误响应 `{error:{code,message,requestId,details?}}`；details 不回显证件、密钥及内部查询。401 未认证；403 无权限；404 资源不可见；409 并发/幂等/租约冲突；422 字段或业务守卫失败；429 限流。
- 有版本的修改按路由发送 `expectedVersion/expectedEventVersion/expectedMatchVersion` 等明确字段，成功返回新版本。P05-A命令使用body中的 `commandId` 实现作用域幂等，不使用HTTP `Idempotency-Key`；通用header幂等机制尚未实现。P03邀请安全重复接受见第6节，P05命令先当前动作授权再查重，均不返回已失去权限的历史响应。
- 时间戳采用 ISO 8601 UTC；赛事日期用 `YYYY-MM-DD`，另带有效 IANA timezone。所有枚举大写；客户端不能自行提交创建者、审批人、角色或资源归属为权威值。

角色：`ORG_OWNER / ORG_ADMIN` 管理机构；`EVENT_MANAGER` 管指定赛事；`REVIEWER` 审报名；`SCORER` 管指定场次记分；`STREAMER` 管直播包装；`TEAM_MANAGER` 管自己的球队报名；`PLAYER` 仅管理本人资料。平台运营权限独立，公开 VIEWER 无私有写权限。

## 2. P01 Mock 合同

后台表单与 Mock adapter 先约定以下对象，不提前实现真实登录或机构隔离：

```ts
type EventFormat = 'ROUND_ROBIN' | 'GROUP_KNOCKOUT' | 'SINGLE_ELIMINATION';
type CreateEventInput = {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string; // P01 固定为 Asia/Shanghai
  venueName?: string; // 可选，空白归一为未设置
  format: EventFormat;
};
// listEvents(filters)、getEvent(id)、createEvent(input)、updateDraftEvent(id,input,expectedVersion)
// 返回EventSummary/EventDetail，含id、上述字段、status、version、createdAt、updatedAt；新建固定DRAFT，列表/详情status使用EventStatus。
```

`name` 去首尾空白后必填，长度1–80字符；`startDate/endDate` 必填且日期有序；`timezone` 在 P01 固定为 `Asia/Shanghai`；`format` 必填且在枚举内。`venueName` 可选，去首尾空白后最长100字符，空白或缺省归一为未设置；读取 DTO 使用 `venueName: string | null`，UI 对 null 显示“待定”。长度与显示文案跟随 [UI 规格](UI_SPEC.md)。P02服务端已重复执行相同业务校验；Mock 中的权限标签不是安全验收。创建只产生草稿，不能从表单直接发布、收费或开放报名。

## 3. 目标路由清单

下表同时列出已实现入口与长期目标；P02、P03-A、P04-A及P05-A的实际权限、输入和响应以第5–8节及共享契约为准，P05-B已交付合同另见第9节。人员私密资料、保险附件、其他排赛赛制和OBS等目标入口尚不可调用。

下表私有路径均省略 `/v1/orgs/{orgId}`；资源 ID 需按其所属赛事/机构重新校验。

| 方法与路径 | 作用 | 最低授权/阶段 |
|---|---|---|
| GET/POST `/events`；GET `/events/{eventId}` | 列表、创建草稿、详情 | 按授权赛事范围读取，列表也裁剪范围；有机构创建权限者建草稿；P02 |
| PATCH `/events/{eventId}` | 编辑草稿 | EVENT_MANAGER，版本匹配且 DRAFT；P02 |
| POST `/events/{eventId}/commands` | 结束/归档等后续目标 | 尚未实现；P03-A开关报名及冻结使用第6节的registration-commands，P04-A发布使用第7节的revision publish |
| GET/POST `/teams`；GET/PATCH `/teams/{teamId}` | 长期球队资料 | OWNER/ADMIN创建；管理资料须OWNER/ADMIN或本队有效领队；P03-A已实现 |
| POST `/teams/{teamId}/invitations` | 邀请既有用户管理球队 | 仅OWNER/ADMIN，绑定targetUserId；P03-A已实现 |
| POST `/events/{eventId}/entries` | 建立球队参赛草稿 | 本队有效TEAM_MANAGER；工作人员也须另有该队grant；P03-A已实现 |
| PUT `/entries/{entryId}/roster` | 更新本届名单 | 本队领队，版本和名单锁定检查；P03-A已实现 |
| GET/PATCH `/participants/{playerId}/profile` | 读取/补充本人参赛资料 | 本人绑定；领队仅在赛事规则允许的受托字段范围内代填，不能默认读取全部证件；P03 |
| POST `/entries/{entryId}/commands` | 提交/撤回/审核/退回补齐 | 领队或独立 REVIEWER 按具体命令；P03 |
| POST `/participants/{playerId}/insurance-evidence` | 登记受控上传凭证引用 | 本人/本队领队；P03 |
| POST `/insurance-evidence/{evidenceId}/review` | 审核凭证 | REVIEWER；P03 |
| POST `/events/{eventId}/draws` | 分组抽签后续目标 | 尚未实现；P04-A单循环生成及重抽使用第7节schedule-revisions |
| POST `/events/{eventId}/schedule-revisions` | 生成或有理由重抽单循环草稿 | P04-A已实现；具体输入、权限及能力边界见第7节 |
| POST `/schedule-revisions/{revisionId}/validate` | 检查当前草稿并返回冲突 | P04-A已实现；管理权限及双版本检查 |
| POST `/schedule-revisions/{revisionId}/publish` | 一次正式发布当前草稿 | P04-A已实现；事务内重新校验，发布后不支持替换 |
| POST/DELETE `/matches/{matchId}/scorekeeper-lease` | 获取/释放主记分租约 | 本match显式有效SCORER；P05-A已实现，见第8节 |
| POST `/matches/{matchId}/scorekeeper-lease/renew` | 续约 | 同session／tab／lease／fence绑定；P05-A已实现 |
| POST `/matches/{matchId}/commands` | 准备／记分／时钟／确认／重开 | 每type独立授权，P05-A统一命令已实现，见第8节 |
| POST `/matches/{matchId}/result-confirmations` | 独立确认写入口的长期目标 | 尚未实现；P05-A使用commands的CONFIRM_RESULT，GET同名路径只读历史 |
| POST `/matches/{matchId}/reopen` | 独立重开写入口的长期目标 | 尚未实现；P05-A使用commands的REOPEN_RESULT |
| POST `/matches/{matchId}/broadcast-sessions` | 绑定本场直播会话 | STREAMER；P06 |
| POST `/broadcast-sessions/{sessionId}/overlay-grants` | 签发只读包装授权 | STREAMER；P06 |
| POST `/overlay-grants/{grantId}/revoke` | 撤销包装授权 | STREAMER/机构管理员；P06 |

全局身份路由单独使用 `GET /v1/me`、`GET /v1/me/organizations`（工作人员上下文）、`GET /v1/me/team-contexts`（本人球队/参赛上下文）。它们只返回本人可进入的范围，不因参加赛事而获得机构后台权限。

`POST /v1/invitations/{invitationId}/accept` 是已登录受邀者接受邀请的独立入口；验证令牌hash、有效期、用途、目标受邀者和未被消费状态，事务内建立限定资源绑定并记录接受，不能凭客户端给出的userId绑定他人。重复接受仅向同一已核验身份返回既有结果；撤销、过期、越范围的邀请拒绝。机构工作人员的邀请/撤权和平台套餐开通接口在 P02/P06 对应任务细化，不从本路由表推定已经实现。文件上传另设授权申请/完成接口，下载临时链接须重新鉴权，URL 不能永久公开。

P05-B已交付并验收第9节的公开event及其schedule／standings／嵌套match读取；旧目标 `/v1/public/matches/{publicId}/snapshot` 未实现，不是本卡入口。P06-A已交付第10节的`/v1/overlays/{overlayId}/bootstrap`及`/snapshot`；`/stream`与旧broadcast-session／overlay-grant管理目标未实现，不能混用。

## 4. 比赛命令和冲突

P05-A实际命令为 `{commandId,expectedVersion,type,payload,capturedAt,control?}`，control嵌套包含leaseId、fencingToken及clientInstanceId，不把凭据散落顶层。精确输入、控制要求和错误见第8节及[共享契约](../packages/contracts/index.d.ts)。当前只采集球队得分、犯规、暂停；有限正式排名及公开观赛见已验收的第9节，专业球员统计、一次投篮派生个人和球队统计及OBS包装仍属后续范围。

撤销和替换引用同场原统计事件；结束计分只进入PENDING_CONFIRMATION。确认使用命令expectedVersion检查精确当前match版本，并保存确认前的sourceMatchVersion／lastEventSeq。重开保留旧确认且标记待重确认，不直接返回LIVE；正式榜单的消费规则见已交付的第9节。

P05-A通过私有snapshot轮询读取，不提供SSE、WebSocket或outbox。后续实时消息应带版本、serverTime和有限投影，发现缺口后重取快照；视频和OBS不成为记分成功的前置条件。

## 5. P02 已整合契约

P02状态DONE / MAIN，范围已通过真实数据库和API浏览器验收；CI及交接见[TESTING](TESTING.md)。使用 `packages/contracts` 的SessionData/EventData。事件字段沿P01，私有API的每个赛事额外返回 `permissions:{canEditDraft:boolean}`，依据该场真实授权及DRAFT计算；Mock允许省略。机构EVENT_MANAGER可能只分配某场SCORER，因此前端不能用全局角色推断编辑权；服务端再次执行动作授权。

| 方法与路径 | 输入/响应与权限 |
|---|---|
| POST `/v1/auth/register` | `{email,password,displayName,organizationName}`，201返回SessionData并建会话；机构初始OWNER。生产默认关闭自主注册，没有邮箱验证/微信身份声明 |
| POST `/v1/auth/login` | `{email,password}`，200返回SessionData并轮换浏览器Cookie；错误登录401通用文案 |
| GET `/v1/auth/session` | `{user:{id,email,displayName},organizations:[{id,name,role}],teamContexts:[{orgId,organizationName,teamId,teamName}]}`；teamContexts由P03-A增加，仅本人当前有效范围 |
| POST `/v1/auth/logout` | 200 `data:null`，撤销当前令牌并清Cookie；无Cookie幂等退出 |
| GET/POST `/v1/orgs/{orgId}/events` | 列表先授权裁剪，创建仅OWNER/ADMIN，初始DRAFT |
| GET/PATCH `/v1/orgs/{orgId}/events/{id}` | OWNER/ADMIN管理本机构赛事；其他仅分配赛事可读，具体EVENT_MANAGER分配可编辑草稿；PATCH是完整CreateEventInput+expectedVersion |
| GET `/v1/orgs/{orgId}/members` | 仅OWNER列机构成员；不返回密码哈希或会话 |
| PUT `/v1/orgs/{orgId}/members/{userId}` | OWNER对已存在用户增改 `{role,status}`；不授予或修改OWNER，status ACTIVE/DISABLED |
| PUT `/v1/orgs/{orgId}/events/{id}/staff/{userId}` | OWNER/ADMIN对有效机构成员增改 `{role,status}`；staff role EVENT_MANAGER/REVIEWER/SCORER/STREAMER |
| GET `/health` | 数据库探测；只返回健康状态或固定故障文案 |

列表仅接收 `q/status/limit/cursor`，省略status表示全部（不传ALL）；limit默认20、范围1–100。按createdAt/id倒序稳定分页，保留PG微秒精度；cursor绑定机构、用户及筛选。前端Http adapter依次取完分页，有后页错误时整个读取失败，不返回不完整成功结果。

会话Cookie `scb.sid` 为随机256bit，HttpOnly/SameSite=Lax，生产Secure；服务端仅存SHA-256。每请求重查用户、会话、机构、成员和赛事分配，前端不保存令牌。所有POST/PUT/PATCH/DELETE（含登录注册）要求Origin精确匹配APP_ORIGIN；配置必须是HTTP(S) origin，生产必须HTTPS。P02使用同源代理，无前端直传角色或用户身份授权。

密码12–128 Unicode码点，不截断；scrypt N131072/r8/p1、16字节随机盐、64字节派生键，存参数与哈希而非密码。注册和登录有数据库时间窗限流，429附Retry-After。字段失败为 `error.details.fieldErrors`，保留requestId；畸形JSON400，超限413，已知编码/媒体错误415使用固定文案，不回显请求或堆栈。未知/跨范围资源 `RESOURCE_NOT_FOUND` 404；401 `UNAUTHENTICATED/INVALID_CREDENTIALS`；其他关键码沿通用契约。

P02没有删除、任意改赛事status、邮件验证、密码重置、工作人员邀请或平台管理接口。第3节的 `/v1/me*` 是后续目标入口；P02以 `/v1/auth/session` 提供当前上下文，不同时伪造两套已实现路由。

## 6. P03-A Web报名实施契约（DONE / MAIN）

共享类型以 `packages/contracts/index.d.ts` 为准。代码head `c2d96b2f2b3801bedcb7e73258b48f5d05c88a83` 经[CI39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)全部通过并由PR #3合并main：100项单元／组件／HTTP检查、44项独立PG场景、实际PG重启，以及12项Mock和6项真实API浏览器场景。下列业务路径均在 `/v1/orgs/{orgId}` 下，身份及接受邀请入口除外；此交付不代表生产部署。

| 方法与路径 | 行为与授权 |
|---|---|
| POST `/v1/auth/register-participant` | email/password/displayName；只创建User+Session，没有机构或工作人员成员；返回SessionData |
| GET `/v1/auth/session` | P03新增teamContexts，和organizations分别返回；不因接受邀请获得机构后台权限 |
| GET/POST `/teams`；GET/PATCH `/teams/{id}` | OWNER/ADMIN创建，初始不自动授领队；OWNER/ADMIN或当前本队领队读取和管理，其他工作人员身份不自动授予球队管理权 |
| PUT `/teams/{id}/members` | `{expectedVersion,members:[{id?,name}]}`；最多60人，新人服务端生成id，移出归档，旧报名快照不变 |
| GET/POST `/teams/{id}/invitations` | 仅OWNER/ADMIN签发明确existing targetUserId；expiresInHours整数1–168；创建一次返回`{invitation,token}`，读取不返回token/hash |
| POST `/teams/{id}/invitations/{inviteId}/revoke`；PUT `/teams/{id}/grants/{userId}` | OWNER/ADMIN分别撤销未消费邀请或改grant ACTIVE/DISABLED；撤销邀请不代替停用已接受的授权 |
| POST `/v1/invitations/{id}/accept` | 已登录明确target，body仅token；检查用途/hash/期限/撤销/邀请人当前资格；已消费且当前grant仍ACTIVE时安全返回既有TeamContext，不更新邀请、grant或审计；当前grant缺失/DISABLED则409，不恢复授权 |
| GET `/teams/{id}/registration-events` | 领队可见已开放赛事及本队已有报名；不泄露其他球队名单或未公开草稿 |
| GET `/events/{id}/registration` | 授权工作人员读取event/rules/counts/freeze/capabilities |
| PUT `/events/{id}/registration-rules` | DRAFT及赛事管理权，expectedVersion为event.version；人数上下限、0/00规则、是否要求身份/保险，追加不可变规则版本 |
| POST `/events/{id}/registration-commands` | OPEN_REGISTRATION / CLOSE_REGISTRATION / FREEZE_REGISTRATION，CAS及具体状态守卫；不支持任意改状态 |
| GET `/events/{id}/entries` | 按工作人员赛事范围或本队grant范围返回分页EntrySummary；筛选与授权在分页前执行 |
| POST `/events/{id}/entries`；GET `/entries/{id}` | 创建仅有效领队、OPEN、同赛事同队唯一；详情按工作人员赛事范围或本队grant范围返回完整EntryData |
| PUT `/entries/{id}/roster` | expectedVersion+memberId/jerseyNo；从当前有效本队成员快照姓名，始终新建不可变revision |
| POST `/entries/{id}/commands` | SUBMIT/WITHDRAW/APPROVE/REQUEST_CHANGES/REJECT，CAS；退回及拒绝reason1–500必填 |

列表默认20、最多100，nextCursor绑定当前用户/机构/资源/筛选。EntrySummary仅含 `id/eventId/teamId/teamName/status/version/rosterRevisionId/lastSubmittedBy/latestReviewReason` 九字段，不展开players、rules、history或动作capabilities；这些仅在独立鉴权的EntryData详情读取。其他带动作的资源DTO显式返回capabilities。UI逐页取完才返回成功，后页失败、非法或循环游标整体报错；具体操作依赖服务端资源权限并再次鉴权。

规则minPlayers1–60，maxPlayers不低于min且不超过60。号码仅0、00、1–99，零号等价性按锁定规则检查。要求身份或保险为true时阻止开放，不能因本卡未接供应商而自动豁免。

提交名单只读；审核者不得是当前领队或lastSubmittedBy，OWNER也不例外。APPROVED修改先被独立审核者退回，再保存新revision并重提。CLOSED仅CHANGES_REQUESTED可补交，保存保持该状态；DRAFT不能关闭后新提交。REJECTED/WITHDRAWN终态，不隐式重建。

冻结要求CLOSED、至少2批准、没有SUBMITTED/CHANGES_REQUESTED。DRAFT/REJECTED/WITHDRAWN排除数显式返回；服务端查询批准revision生成不可变freeze，客户端不能提供名单清单作为权威。冻结后停止全部报名与审核写入，不自动发布赛程。

邀请token只在URL fragment传递，首次加载及hashchange读取后立即清除，不进入localStorage/sessionStorage；后收到的邀请不会被旧接受请求的晚返回清除。用户主动切换机构／球队工作空间进入对应首页，后台刷新授权保留合法详情路径，球队上下文不会显示另一球队资料。邮箱尚未验证，不能按email认领邀请；没有邮件发送、微信身份、身份证核验、保险文件上传、支付或OBS服务。

## 7. P04-A单循环排赛实施契约（DONE / MAIN）

精确DTO见[共享契约](../packages/contracts/index.d.ts)。[PR #4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并为main `9fc9b3019eeef52d5b7a66643b01f0fe993af09f`，代码 `7336bfa01a6a3b6afb08dd2c90260f8497b1239e` 经[首轮CI39737812114](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114)全部成功：158项源码／组件／HTTP检查、68项独立PG、真实PG18.6重启、12项Mock和8项API浏览器。001→002→003已在隔离测试库执行及复跑校验，没有生产部署或生产Migration。历史阶段计数见[TESTING](TESTING.md)。

以下路径均省略 `/v1/orgs/{orgId}`，继续执行当前会话、机构成员、实际赛事分配及Origin守卫；球队grant不授后台排赛权限。OWNER/ADMIN或该场实际EVENT_MANAGER可生成、重抽、分配、校验和发布，其他已分配工作人员只读；capabilities由服务端逐资源返回。

| 方法与路径 | 输入、响应与状态 |
|---|---|
| GET/POST `/courts`；PATCH `/courts/{id}` | 机构共享Court；仅OWNER/ADMIN创建、改名或改ACTIVE/DISABLED，name去首尾空白后1–80，机构内lower名称唯一；列表meta.capabilities.canCreateCourt。停用仍有未来或进行中正式预约的场地409 COURT_HAS_RESERVATIONS |
| GET `/events/{eventId}/scheduling` | EventSchedulingData：event、freeze摘要、currentRevision、publication、support及capabilities |
| POST `/events/{eventId}/schedule-revisions` | expectedEventVersion、freezeId、algorithmVersion RR_CIRCLE_V1、policy；创建／重抽201 ScheduleRevisionData。重抽必填redrawReason1–500，新seed和新revision，旧稿SUPERSEDED只读；previousRevisionId保留历史链 |
| GET `/schedule-revisions/{id}` | 当前或历史ScheduleRevisionData，批量读取source、policy、轮次／轮空、participants和至多496场fixtures；eventVersion是当前赛事版本，不能用freeze.eventVersion替代 |
| PUT `/schedule-revisions/{id}/allocations` | expectedEventVersion、expectedRevisionVersion及精确覆盖全部fixtureKey的allocations；每项courtId/startsAt同时null表示未分配。只能改当前DRAFT；成功递增赛事和revision版本，200返回新ScheduleRevisionData |
| POST `/schedule-revisions/{id}/validate` | 双版本，200 ScheduleValidationData，包含精确版本、checkedAt、valid和conflicts；只读，不修改版本 |
| POST `/schedule-revisions/{id}/publish` | 双版本，事务内重新验证后200返回新EventSchedulingData；唯一event publication，正式场次、预约、PUBLISHED和赛事REGISTRATION_CLOSED→SCHEDULED/version及audit同事务 |
| GET `/events/{eventId}/matches` | ScheduledMatchData分页，按startsAt/id正序稳定读取正式场次；暂无公开或球队grant读取路径 |

Court及matches列表默认20、最大100，游标绑定当前机构、用户和资源。前端逐页读完才成功，后页失败不退Mock。Court改名不改变已发布courtName快照，服务没有Court删除接口。

仅支持2–32支不可变freeze球队单回合ROUND_ROBIN。服务端256bit十六进制seed持久化，先按entryId ASCII规范化，再按SHA256(seed+'|'+entryId)排序并用RR_CIRCLE_V1轮转；奇数轮空不生成假比赛。inputHash／pairingHash／publicationHash的固定序列化及已知向量见[算法](../apps/api/src/scheduling-domain.ts)和[源码测试](../apps/api/src/scheduling-domain.test.ts)。发布时从原freeze、policy和seed重算来源、轮次和双方，并核对预计占用时长。长期成员变化不修改来源；seed不是授权凭据。

SchedulePolicy必须明确slotDurationMinutes整数1–1440、minRestMinutes整数0–43200、minLocalDayGap整数0–365及1–200个courtWindows。输入时间严格验证真实日历和明确偏移后归一UTC；同Court窗口不能重叠，server计算endsAt。场次须完整落在窗口及Asia/Shanghai赛事日期内，结束恰为末日次日00:00允许。同赛事按前场结束计算休息、按本地开赛日计算日期差；跨赛事同canonical Team只保证不重叠，不宣称协调不同休息政策。

合法但未分配、越窗口或存在冲突的分配可保存草稿，草稿不占正式资源；发布必须全部通过。冲突码为UNASSIGNED、OUTSIDE_WINDOW、OUTSIDE_EVENT_DATES、COURT_DISABLED、COURT_OVERLAP、TEAM_OVERLAP、MIN_REST和MIN_LOCAL_DAY_GAP。validate返回200 valid=false；合法分配但发布冲突409 SCHEDULE_CONFLICT并附details.conflicts；双CAS错误409 VERSION_CONFLICT，旧稿409 SCHEDULE_REVISION_NOT_CURRENT，重复发布409 SCHEDULE_ALREADY_PUBLISHED；非法字段／时间422，不可见或越租户Court404。其他状态错误按具体守卫返回INVALID_SCHEDULING_STATE等稳定业务码，不能把所有状态错误一概算409。

发布前重算所有内部及本机构已发布Court/Team占用；validate不是发布凭证。外部赛事冲突只返回本方fixture/resource/time，不泄露另一赛事ID、名称或名单。一次发布后不能编辑、重抽或再次发布；P04-A不包含自动排时、其他赛制、改期／取消占用、公开赛程、小程序或OBS。记分／赛果已由第8节P05-A扩展，预计场地占用与实际比赛时钟仍分离，机构内资源检查不覆盖跨机构同一物理球场。


## 8. P05-A在线基础记分实施契约（DONE / MAIN）

[PR #5](https://github.com/xyq-dev/small-city-basketball/pull/5)合并main `3c0bf8408b181d6e96c00b348d7cebb7bad54aef`；验收代码 `1cb8e41400de4e497580e98c7eb77d6a7a02e079` 经[第二CI39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)全部成功：212项源码／组件／HTTP、88项独立PG、实际PG18.6重启、12项Mock及10项API浏览器。精确DTO以[共享契约](../packages/contracts/index.d.ts)为准；首轮失败与修复、自动审查状态及证据边界见[TESTING](TESTING.md)。没有生产执行。

以下路径均省略 `/v1/orgs/{orgId}`，每请求复核session/user、机构成员、资源归属及具体动作；所有写操作继续要求精确Origin。成功写及控制操作为200，不新增另一套CONFIRM／REOPEN写入口。

| 方法与路径 | 输入、响应与授权 |
|---|---|
| GET `/scoring-matches` | 可选eventId/status及limit/cursor；SQL先过滤OWNER/ADMIN、实际event staff或本match有效staff可见范围，再分页返回ScoringMatchSummary[] |
| GET `/events/{eventId}/scoring` | EventScoringData：event、当前／锁定rules、locked和canManageRules；赛事管理者／实际赛事工作人员可读，只有单场分配者不因此获得整赛事资料 |
| PUT `/events/{eventId}/scoring-rules` | 显式规则+expectedEventVersion，追加规则版本并递增Event.version；OWNER/ADMIN或实际EVENT_MANAGER，首次READY后永久锁定 |
| GET `/matches/{matchId}/scoring` | ScoringWorkbenchData：match、当前event版本、绑定rules、可空snapshot、staff、脱敏lease占用摘要及资源capabilities；不得当作公开DTO |
| PUT `/matches/{matchId}/staff/{userId}` | expectedMatchVersion、role SCORER/RESULT_REVIEWER、status ACTIVE/DISABLED；赛事管理权。ACTIVE要求用户及机构成员有效；DISABLED只更新既有本场分配，允许机构成员／用户已停用，不能空建DISABLED；同时使受影响旧lease过期。返回新workbench |
| POST `/matches/{matchId}/scorekeeper-lease` | `{clientInstanceId}`；显式有效SCORER可在READY/LIVE/PENDING_CONFIRMATION取得控制，返回ScorekeeperLeaseData |
| POST `/matches/{matchId}/scorekeeper-lease/renew`；DELETE同主路径 | `{control:{leaseId,fencingToken,clientInstanceId}}`；当前有效绑定才可续约／释放。续约返回lease，释放data:null |
| POST `/matches/{matchId}/commands` | ScoringCommandInput，按type检查当前动作权限；返回 `{receipt,snapshot}`，原receipt.appliedVersion与当前snapshot.version分别解释 |
| GET `/matches/{matchId}/commands/{commandId}` | 当前身份在本match的收据，match读锁等待在途写提交；返回receipt+当前snapshot，未知404 COMMAND_NOT_FOUND。重新检查对应动作权限 |
| GET `/matches/{matchId}/snapshot` | 私有ScoreSnapshot；未准备409 MATCH_NOT_PREPARED，workbench中的snapshot此时为null |
| GET `/matches/{matchId}/scoring-events` | ScoringEventData[]，seq正序，top-level targetEventId表示撤销目标；同场读取权限 |
| GET `/matches/{matchId}/result-confirmations` | ResultConfirmationData[]，sourceMatchVersion/id正序，保留旧确认与确认人；私有读取，不是POST确认入口 |

三个列表默认20／最多100。scoring-matches按startsAt/id正序，游标绑定org/user/event/status；事件和确认游标绑定org/user/match及资源类型。前端取完所有页才报告完整成功，后页失败不接受部分数据、不退Mock。

### 规则、状态与命令

规则必须显式给出regulationPeriods整数1–8、periodDurationSeconds整数1–3600、allowedScoreValues为[1,2,3]非空不重复子集、tiePolicy ALLOW_DRAW/OVERTIME；OVERTIME需overtimeDurationSeconds整数1–1800，ALLOW_DRAW为null。不暗设FIBA节长、罚球、暂停配额或排名积分。

| type | payload与状态守卫 | 控制／最低授权 |
|---|---|---|
| PREPARE_MATCH | `{expectedEventVersion}`；SCHEDULED→READY，已有正式冻结来源、规则及至少一个仍有效SCORER；初始化第1节、暂停、完整节长并锁定规则 | 禁止control，赛事管理权 |
| START_MATCH | `{expectedEventVersion}`；READY→LIVE，时钟仍暂停；首场开始使Event SCHEDULED→RUNNING，同事务CAS | 必须control，显式SCORER |
| RECORD_STAT | `{kind,side,value}`；仅LIVE；kind SCORE/FOUL/TIMEOUT、side HOME/AWAY；SCORE遵循允许分值，FOUL/TIMEOUT每次1 | 必须control，显式SCORER |
| ADD_CORRECTION | `{kind,side,value,period,reason}`；LIVE或PENDING，period须已有节次 | 必须control，显式SCORER |
| VOID_STAT／REPLACE_STAT | 前者`{targetEventId,reason}`，后者再含side/value；只针对本场仍有效统计，替换保留原kind及period，原子追加STAT_VOIDED+STAT_RECORDED | 必须control，显式SCORER |
| CLOCK_START／CLOCK_PAUSE | `{}`；仅LIVE；显式启动／暂停，暂停保存服务端有效剩余 | 必须control，显式SCORER |
| CLOCK_SET | `{remainingMs,reason}`；0至本节时长，运行中校时保持running并重设锚点 | 必须control，显式SCORER |
| NEXT_PERIOD／START_OVERTIME | `{}`；暂停且有效剩余0；前者仅下一常规节，后者仅常规／加时结束后平分且规则允许 | 必须control，显式SCORER |
| END_MATCH | `{}`；末常规／加时已归零且暂停，OVERTIME不允许平分；LIVE→PENDING_CONFIRMATION | 必须control，显式SCORER |
| CONFIRM_RESULT | `{}`；精确当前版本、投影按事件重放一致，PENDING→FINAL；OVERTIME平分拒绝 | 禁止control；管理者或本场RESULT_REVIEWER，且必须满足独立性 |
| REOPEN_RESULT | `{reason}`；FINAL→PENDING，保留旧确认并requiresReconfirmation；不恢复LIVE | 禁止control，赛事管理权 |

reason去首尾空白后1–500字符。命令公共字段commandId为UUID、expectedVersion为当前match版本、capturedAt为真实带时区时间；后者只作不可信采集元数据，不决定服务器计时或seq。PREPARE/START另校验payload.expectedEventVersion，其他命令不伪造Event CAS。每次业务变更增加match.version，人员变更也同步projection.sourceVersion；lease心跳不增加比赛版本，clockVersion只随实际时钟／节次动作变化。

读权限为OWNER/ADMIN、任何实际有效event staff或本match有效staff；单场SCORER无需EventStaff也可读写本场，不能因此读其他比赛。OWNER/ADMIN不能自动写分。确认者不得是任何历史开始／结束／计分／时钟／更正操作者、当前主写者或双方Team当前有效领队；OWNER也不例外。准备、分配、租约和重开本身不计入实际记分历史，撤权和撤销统计不会清除历史禁自确认条件。

### 幂等、租约、时钟与恢复

幂等键为org/actor/match/commandId；规范内容hash相同返回原receipt及当前snapshot，不再追加事件、版本或审计；异内容409 IDEMPOTENCY_CONFLICT。当前动作授权先于查重；成功重放可跨旧lease过期或旧expectedVersion，但不能跨当前撤权。新命令必须匹配CAS及控制条件，事件、投影、match、收据和审计同事务提交，失败全回滚。

租约TTL30秒、前端每10秒续约；绑定session、每tab内存UUID clientInstanceId、随机UUID leaseId及十进制int64字符串fencingToken。新持有者单调增加fence，同绑定未过期acquire可返回既有控制；过期renew/release不能复活或释放后继租约。控制凭据不写localStorage/sessionStorage，页面刷新不承诺恢复旧tab身份。释放或过期不自动暂停比赛时钟。

clock.remainingMs是原始锚点剩余值，anchorServerTime保留对应服务端时间；响应serverTime供客户端插值，不能先减一次后沿旧anchor再减。写路径在锁取得后使用单次clock_timestamp()，不使用事务起点now或capturedAt。显示最低0，raw running归零仍保持true，NEXT/END前需显式暂停；不每秒写库。

ScoreSnapshot含实际MatchStatus、双方冻结展示信息、已采集球队基础统计、规则、clock、当前版本、latestConfirmation和requiresReconfirmation；不含lease/session/control或私密报名资料。确认记录sourceMatchVersion／lastEventSeq绑定确认前快照，CONFIRM自身生命周期事件和receipt.appliedVersion随后增加；FINAL后合法人员变更可增加比赛版本而不改变确认统计。重开保留旧记录，待重确认不冒充当前正式结果。

未知提交结果时保留原envelope与commandId，先查收据和权威快照；404不证明该请求将永远无法提交。只有完全相同原命令且当前控制／版本条件仍允许时才重发，不能自动换ID重复加分。断网停止新写，页面销毁／浏览器崩溃不承诺未持久命令恢复；本卡不实现可靠离线队列。

关键实际错误：422 VALIDATION_ERROR／RULE_CONFLICT／SCORING_RULES_REQUIRED／INVALID_STAT_TARGET；409 VERSION_CONFLICT／LEASE_CONFLICT／IDEMPOTENCY_CONFLICT／INVALID_MATCH_STATE／SCORING_RULES_LOCKED／SCORER_REQUIRED／MATCH_NOT_PREPARED／PROJECTION_MISMATCH；隐藏资源404 RESOURCE_NOT_FOUND、未知收据404 COMMAND_NOT_FOUND，可见无动作权限403 FORBIDDEN。不能把长期目标中的LEASE_EXPIRED等细分码当作本卡接口。

P05-A只实现在线基础记分及私有读取；共享MATCH_STATUSES为SCHEDULED、READY、LIVE、PENDING_CONFIRMATION、FINAL、POSTPONED、CANCELLED，后两者仅预留，没有变更接口。不自动COMPLETED赛事；正式积分／同分排序及公开观赛的P05-B已交付实现见第9节。SSE/outbox、可靠离线、球员专业统计、弃权／争议、延期恢复、淘汰晋级及OBS仍待后续任务。P04正式来源、计划和预约仍不可变，FINAL场次读取返回真实状态，不回写SCHEDULED。

## 9. P05-B排名及公开观赛契约（DONE / MAIN）

本节依据P05-B验收source d9161e96及[共享契约](../packages/contracts/index.d.ts)，不是生产可用声明。[最终CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)通过302项源码检查（admin147／API155）、106项独立PG、001→005隔离执行／复跑、37表实际PG18.6重启及12Mock＋12API官方Chromium浏览器。005内容／SHA-256未变；限流隔离、非ROUND_ROBIN入口及负向清理checker的修复与历史见[TESTING](TESTING.md)。完整行为范围见[任务卡](tasks/P05-B.md)。

### 私有管理入口

私有路径省略 `/v1/orgs/{orgId}`。读取要求当前有效机构成员，且为OWNER/ADMIN或本event实际有效工作人员；仅有MatchStaff不授予整届排名权限。写入限OWNER/ADMIN或本event实际EVENT_MANAGER，重新检查会话、成员、分配及精确Origin；全局角色不能替代赛事分配。

| 方法与路径 | 精确输入与成功结果 |
|---|---|
| GET `/events/{eventId}/standings` | 返回EventStandingsData；尚无规则或正式赛程时standings为null，已有未锁规则及赛程时mode为DRAFT_PREVIEW |
| PUT `/events/{eventId}/standings-rules` | `{expectedEventVersion,winPoints,lossPoints,drawPoints,tiebreakers}`；追加不可变当前草稿，递增Event.version，200返回EventStandingsData |
| POST `/events/{eventId}/standings-rule-commands` | `{type:'PUBLISH_STANDINGS_RULES',rulesetId,expectedEventVersion}`；仅发布本届当前草稿，永久锁定规则，200返回EventStandingsData |
| POST `/events/{eventId}/public-viewing-commands` | `{type:'ENABLE'|'DISABLE',expectedEventVersion}`；启用须已锁排名规则及正式单循环赛程；每次重新启用创建全新公开身份；200返回EventStandingsData |

`winPoints/lossPoints/drawPoints`均显式必填整数0–1000；tiebreakers显式数组，可为空或为SCORE_DIFFERENCE、POINTS_FOR、WINS的不重复有序子集。仅支持2–32队单回合ROUND_ROBIN；不支持HEAD_TO_HEAD、胜率、分组／淘汰、弃权、处罚积分或净胜分封顶，不预设FIBA积分。

EventStandingsData精确组成：`event:EventData`、`rules:StandingsRulesetData|null`、`locked:boolean`、`standings:StandingsData|null`、`publication:PublicViewingPublicationData|null`、capabilities。规则DTO为`{id,eventId,version,algorithmVersion:'RR_STANDINGS_V1',createdAt,winPoints,lossPoints,drawPoints,tiebreakers}`；publication仅为`{publicEventId,status:'ACTIVE'|'REVOKED',createdAt,revokedAt:string|null}`。capabilities固定包含canManageRules、canPublishRules、canEnablePublicViewing、canDisablePublicViewing四个boolean，不靠全局角色猜测。

StandingsData为`{mode:'DRAFT_PREVIEW'|'PUBLISHED',rulesetVersion,sourceHash,asOf,confirmedMatchCount,totalMatchCount,isComplete,hasSharedRanks,rows}`。私有每行含entryId、teamId、teamName、rank:number|null、tied及played/wins/draws/losses/pointsFor/pointsAgainst/scoreDifference/leaguePoints。先积分降序，再按显式tiebreakers逐项降序；全相同则共享1,1,3竞赛名次，冻结顺序仅稳定展示。零有效确认时所有rank为null；部分完赛不做场次／胜率补偿，isComplete只表示正式场次全部有效确认且总数大于0，不推进Event COMPLETED或宣布唯一冠军。

DISABLE不依赖榜单来源健康：授权、CAS、撤销及audit成功后返回`standings:null`，保留正确的event/rules/publication/capabilities；后续GET仍核验来源并可返回RESULT_SOURCE_INVALID。重复ENABLE或没有有效发布时DISABLE均409，不幂等创建新链接。

### 匿名只读入口与DTO

公开路径前缀 `/v1/public/events/{publicEventId}`，四个入口均GET，无写路由、目录搜索或登录要求。控制器不读取Cookie；相同公开身份不因调用者是否登录而扩大字段。前端独立public fetch使用`credentials:'omit'`，不触发私有会话处理；此处不授权OBS或记分。

| 方法与后缀 | data及分页 |
|---|---|
| GET主路径 | PublicEventData |
| GET `/schedule` | PublicScheduleMatchData[]；limit默认20／最多100，可选status和cursor；meta.nextCursor为下一页或null |
| GET `/standings` | PublicStandingsData |
| GET `/matches/{publicMatchId}` | PublicMatchSnapshotData；必须属于本次公开publication |

公开身份独立于内部UUID：publicEventId／publicMatchId为32随机字节的43字符base64url文本，teamKey为本次publication独立16随机字节的22字符文本。重新启用后全部重新生成，旧链接永久失效。schedule按真实startsAt及publicMatchId正序；游标明文仅含`{scope:'public-schedule:<publicEventId>:<status或空>',time:<UTC六位小数时间>,publicMatchId}`再作base64url编码，不能夹带org/user/event/match/entry/team内部ID，跨父身份或筛选的游标拒绝。

| 公开DTO | 完整允许字段 |
|---|---|
| PublicStandingsRules | version、algorithmVersion、winPoints、lossPoints、drawPoints、tiebreakers；没有私有rulesetId/eventId/createdBy |
| PublicEventData | publicEventId、name、startDate、endDate、timezone、venueName:null或string、status、rules、confirmedMatchCount、totalMatchCount、isComplete、serverTime |
| PublicStandingsData | publicEventId、rules、sourceHash、asOf、confirmedMatchCount、totalMatchCount、isComplete、hasSharedRanks、rows；每行仅teamKey、teamName、rank、tied及上述八项累计统计 |
| PublicScheduleMatchData | publicMatchId、roundNo、positionNo、home/away各`{teamKey,teamName}`、courtName、startsAt、endsAt、status、version、score:null或`{home,away}`、resultStatus |
| PublicMatchSnapshotData | schedule单场字段，再含publicEventId、eventName、totals、periods、rules、clock、collected、serverTime；totals为双方`{score,fouls,timeouts}`，periods每项为`{period,home:{score,fouls,timeouts},away:{score,fouls,timeouts}}`，两者可null |

单场rules为`ScoringRules & {version}`或null，clock为`{period,remainingMs,running,anchorServerTime,clockVersion}`或null；raw remainingMs不先扣时，客户端据serverTime和锚点只插值一次。未准备比赛score/totals/periods/rules/clock为null，collected的teamScore/teamFouls/teamTimeouts为false；准备后真实0可展示，playerStatistics始终false。resultStatus仅UNCONFIRMED、CONFIRMED、REQUIRES_RECONFIRMATION。正式统计从有效确认取证，重开不展示旧确认作为当前正式结果。

所有嵌套对象按白名单重建，不序列化私有Workbench／ScoreSnapshot再删字段。公开不含名单、球员姓名／号码、工作人员／确认人、事件／收据、内部ID、email、联系方式、身份／保险材料、session/lease/fence/control或写凭据。未知／撤销／跨父公开身份／不活跃机构或不可公开赛事404，读取均no-store；打开页面只能在下一次轮询发现撤销后清屏，不能承诺零延迟撤屏或推送。其他读取失败保留资料须标陈旧，不能伪造0分。

### 唯一正式来源与失败处理

单条批量SQL以全部正式matches为基表LEFT JOIN同场state、当前confirmation、最后event、对应receipt及scoring_rules，使用同一语句MVCC快照；不可变freeze、排名规则及正式计划另在Event锁保护下读取。任何FINAL证明不全则整张榜单／公开投影409 RESULT_SOURCE_INVALID，固定无私密详情消息，不用INNER JOIN或筛选静默漏掉坏场次。

有效FINAL要求state.source_version等于当前match.version、requires_reconfirmation=false；latest确认指针／规则ID及版本／双方总数及完整按节合计一致。确认前lastEventSeq加1必须等于state.last_event_seq和最后CONFIRM_RESULT事件seq，操作者、空payload及receipt相符；receipt.appliedVersion为confirmation.sourceMatchVersion加1且不大于当前比赛版本，首末seq均为该确认事件。终局还须clock_running=false、remaining_ms=0、period不少于绑定规则的常规节数；独立审查发现的这三项缺口已修复并有反例。FINAL后合法staff变更可以增加match/state版本而不撤销赛果；它们及读取时间不参与sourceHash。重开整场退出，重确认仅计最新一次；hash绑定规则、冻结顺序及当前确认身份／统计，不能把旧记录重复累计。

私有写按actor/session→org/member→Event UPDATE→规则/publication/映射，授权/CAS/Event版本/audit同事务，deferred COMMIT失败也整体回滚。匿名先解析公开身份，再按org SHARE→Event SHARE→publication SHARE取锁，重查机构、赛事和发布有效性；撤销提交后的新读取拒绝。公开GET不写访问计数、不取org_schedule_mutex、不写记分。

实际错误：422 VALIDATION_ERROR／UNSUPPORTED_STANDINGS_FORMAT／STANDINGS_RULES_REQUIRED／SCHEDULE_REQUIRED；409 VERSION_CONFLICT／STANDINGS_RULES_LOCKED／STANDINGS_RULESET_NOT_CURRENT／PUBLIC_VIEWING_ALREADY_ENABLED／PUBLIC_VIEWING_NOT_ENABLED／RESULT_SOURCE_INVALID；隐藏资源404 RESOURCE_NOT_FOUND、可见无动作权403 FORBIDDEN。P05-A记分状态机和授权保持，尚无公开SSE、缓存worker、可靠离线、专业统计、微信、OBS或生产容量验收。

## 10. P06-A独立比分包装合同（DONE / MAIN）

P06-A已通过[PR #7](https://github.com/xyq-dev/small-city-basketball/pull/7)合并main `f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，DONE / MAIN；最终验收source `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`、tree `2a719b4b3e8fd4f67996144c687f5bbb72902519`。[最终CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)全部成功：372项源码（admin171／API201）、123项独立PG、001→006隔离执行／复跑checksum、真实PG18.6重启与39表完整指纹、12Mock及桌面7＋手机7真实API官方Chromium151.0.7922.34浏览器。正常及故意失败流程只清本次owned子库，控制库保留。 共享类型见[contracts](../packages/contracts/index.d.ts)，006内容／hash未变。首轮和最终CI均成功，后15份MD仅修恢复来源与记录，详见[TESTING](TESTING.md)。

### 四条实际入口

全部成功200，采用统一`{data,meta:{requestId}}`及no-store。私有GET／命令每次验证当前私人会话、机构成员、资源归属；源入口完全独立，不调用私人登录流程。两个POST仍要求精确APP_ORIGIN，不放宽全局写Origin守卫。

| 方法与完整路径 | 输入与data |
|---|---|
| GET `/v1/orgs/{orgId}/matches/{matchId}/overlay` | 无body，返回OverlayWorkbenchData；有本赛事实际staff或OWNER/ADMIN可读，单场授权不等于赛事权限 |
| POST `/v1/orgs/{orgId}/matches/{matchId}/overlay-commands` | 下列ISSUE／ROTATE／REVOKE输入，返回OverlayCommandResponse；写仅OWNER/ADMIN或本event实际EVENT_MANAGER／STREAMER且当前成员有效 |
| POST `/v1/overlays/{overlayId}/bootstrap` | `{token}`；成功data仅`{overlayId,expiresAt,serverTime}`，session只由Set-Cookie交付，不进JSON |
| GET `/v1/overlays/{overlayId}/snapshot` | 仅认专用Cookie；返回OverlaySnapshotData，无读取计数／更新时间／续期写入 |

管理写的精确body如下；未知字段422，TTL无默认值，理由去首尾空白后1–200字符。Event UPDATE从入口持有，ROTATE／REVOKE另检查精确当前overlayId及Grant版本；成功touch Event.version与audit同事务，不更改Match.version、记分projection、确认或lease。

```ts
{ type: 'ISSUE', expectedEventVersion, expiresInMinutes }
{ type: 'ROTATE', expectedEventVersion, overlayId, expectedGrantVersion, expiresInMinutes, reason }
{ type: 'REVOKE', expectedEventVersion, overlayId, expectedGrantVersion, reason }
// expected*为正整数；expiresInMinutes为必填整数1–10080。
```

ISSUE仅在没有有效当前Grant时成功；已过期未撤销记录先以固定SUPERSEDED_AFTER_EXPIRY原子关闭后新建。ROTATE永久关闭当前身份再生成新overlayId／secret；REVOKE只关闭。Grant初始version1，撤销后2，到期本身不写库。当前记录包括EXPIRED，history仅最近20条REVOKED，按createdAt／overlayId降序，LIMIT21判断historyTruncated；没有未实现的历史游标。管理命令无自动重放或secret恢复：响应未知先GET核对；若已签发但secret丢失，显式ROTATE，不盲目再ISSUE。

| 管理DTO | 完整允许字段 |
|---|---|
| OverlayGrantData | overlayId、template固定SCOREBAR_1080P_V1、status为ACTIVE／EXPIRED／REVOKED、version、createdAt、expiresAt、revokedAt:null或时间、revocationReason:null或理由 |
| OverlayWorkbenchData | event仅`{id,name,version}`、matchId、preview:null或OverlayPreviewData、previewError:null或`{code:'RESULT_SOURCE_INVALID',message}`、currentGrant:null或未撤销Grant、history、historyLimit:20、historyTruncated、capabilities仅canIssue/canRotate/canRevoke三个boolean、serverTime |
| OverlayCommandResponse | Workbench全部字段加credential；仅成功ISSUE／ROTATE为`{overlayId,token}`，REVOKE为null，GET不能恢复credential |

坏FINAL时私有preview=null及有限previewError，仍返回freshEventVersion、Grant历史及能力；ISSUE／ROTATE／REVOKE成功响应也不能因预览来源错误回滚授权命令。仅场次SCORER／RESULT_REVIEWER、TeamAccessGrant或未实际分配的global STREAMER不能管理；其他本赛事实际staff只读，前端只按capabilities显示动作。

### Secret、Cookie与固定截止

overlayId、secret及session token各为服务端256bit随机值的43字符base64url，DB只存secret／session token的SHA-256。源URL为`/overlay/{overlayId}#token=…`；首次读取后立即replaceState清fragment，保留history.state/path/query，secret仅当前内存，不能进Storage、query、日志或错误。secret在Grant有效期内可重复bootstrap，OBS保存的原始源URL可以重新加载；不是一次消费。

bootstrap始终先验证secret，再考虑专用Cookie。有效同Grant Cookie复用session；单一缺失／无效／过期／其他Grant Cookie在正确secret下可创建新session。重复或歧义同名Cookie即使值相同也404；错误secret不能借有效Cookie或scb.sid通过。无fragment页面直接读snapshot；Cookie失效且无内存secret时终止并提示重新加载保存的原始URL，不回退私人登录。

专用Cookie为`scb.overlay`，host-only、HttpOnly、SameSite=Strict，Path精确`/v1/overlays/{overlayId}/`，生产Secure；Max-Age不超过锁后剩余期限，保守向下取整。Path只减少发送范围，不构成同源XSS隔离；同源可信部署是前提。每个session截止由复合FK精确等于Grant截止，不因刷新续期。session INSERT后可能等待正式match FK锁，服务已补最终DB clock_timestamp精确重检共同截止，过期404且回滚、不返回Cookie；成功metadata.serverTime及Max-Age采用最终fresh时间。该修复经独立静态CLEAR，并已由真实PG外键阻塞跨截止回归验证，过期404且没有新session／Cookie残留。

独立读解析overlayId后按org SHARE→Event SHARE→Grant SHARE→overlaySession SHARE重查机构、撤销及截止；管理按actor/session→org/member→Event UPDATE→eventstaff→Grant取锁，资格/CAS/版本/audit同事务。Grant不依赖签发者私人session在线，个人退出／后续撤权不自动撤销既有Grant；机构inactive会拒绝源读取。公开观赛ENABLE／DISABLE与包装授权相互独立，不依赖排名规则或public publication。

### 有限投影与源生命周期

OverlayPreviewData逐层白名单完整为：eventName、home/away各`{teamName}`、status、matchVersion、score:null或`{home,away}`、totals:null或双方ScoringTotals、periods:null或ScoringPeriodTotals数组、rules:null或`ScoringRules & {version}`、clock:null或原始ScoringClock、collected仅teamScore/teamFouls/teamTimeouts三个boolean及playerStatistics:false、resultStatus（UNCONFIRMED／CONFIRMED／REQUIRES_RECONFIRMATION）、serverTime。OverlaySnapshotData仅再加overlayId、template:SCOREBAR_1080P_V1、expiresAt。ScoringTotals为score/fouls/timeouts；periods每项含period及双方totals；raw clock为period/remainingMs/running/anchorServerTime/clockVersion，不预扣倒计时。

未准备的score/totals/periods/rules/clock均null，已准备真实0才展示，球员统计未采集。独立源不含内部org/event/match/team/entry/user／roster ID、工作人员、确认人、事件／receipt、session/lease/fence或个人资料。单条SQL快照取本场全部来源证明后复用P05-B confirmedResult；合法staff升运行版本不误撤正式赛果，坏FINAL严格409 RESULT_SOURCE_INVALID，无私密details，不能伪造0。

前端每次请求完成后2秒串行轮询、单请求8秒超时，避免2秒poll反复取消慢请求。只有完整有效且非降matchVersion的snapshot重置30秒陈旧期限，bootstrap不算；断网立即陈旧，30秒清比分和队名。Grant硬截止从请求发送performance锚保守扣完整RTT，已知截止只提前；404／到期终止、取消请求并拒绝迟到200重新点亮，409来源故障清屏但继续核对。scope变化／卸载清理请求与timer。原生OBS／CEF行为另验，不能把网页透明渲染称为“OBS已连接”。

实际错误：422 VALIDATION_ERROR；409 VERSION_CONFLICT／OVERLAY_ALREADY_ISSUED／OVERLAY_GRANT_NOT_CURRENT／OVERLAY_GRANT_VERSION_CONFLICT／RESULT_SOURCE_INVALID；私有未知／跨scope或无赛事可见权404 RESOURCE_NOT_FOUND、可见只读staff写403 FORBIDDEN、私人未认证401；独立授权失败统一404，不暴露撤销／过期／错secret／错Grant差异。POST Origin拒绝403 ORIGIN_REJECTED。schema与执行边界见[DATA_MODEL第11节](DATA_MODEL.md)、[TESTING](TESTING.md)。


### P06-A两轮成功CI与恢复来源

首CI39756976748在远端source7ba9d01bb46d8c4b7a5ce72081aef50719d05539（tree52f2681a727b9a5ea4944c6019a8f0eaa0cda8cd）也全部成功；后续15份Markdown只修可达恢复点及记录，没有业务或Migration变化。最终CI再次全部成功后合并PR7。首head文档P2已resolved／outdated，最终addeb自动CodeReview completed且无finding（comment6337630278），security未运行。恢复使用上述main合并点或最终远端source；本地19d5801仅作历史来源，不是fresh checkout恢复入口。两轮run／job与边界见[TESTING](TESTING.md)。原生OBS／CEF、生产与备份恢复仍未验收。


## 11. P07-A运行能力与就绪合同（DONE / MAIN，PR8）

`GET /v1/auth/capabilities`无需身份或DB查询，标准data envelope仅`{canRegisterOrganization:boolean,canRegisterParticipant:boolean}`，不返回用户/机构/密钥。服务构造与HTTP入口共用集中配置：production两项默认false，dev/test默认true；Compose显式机构false、个人true。配置读取失败时UI关闭注册入口并保留登录，watch/overlay独立入口不发私人初始化请求。

`GET /health`仍为连接存活检查；`GET /ready`只读核验完整Migration文件名/checksum集合、btree_gist、当前runtime角色及固定39表/列ACL，成功data `{status:'ready'}`，缺失/漂移/extra migration/高权/缺权统一503 SERVICE_UNAVAILABLE，不输出SQL、role或连接字符串。production启动也先核验，不自动迁移或seed。

scrypt保留既有参数及哈希格式，所有API实例共用进程内1槽与最多16等待，超载/底层计算失败固定503 AUTH_UNAVAILABLE，错误释放槽位。限流每次独立自动提交清理最多100条超过1小时的旧key，再执行原窗口原子计数，不携带其它key锁进入upsert，不删除仍有效计数。

首owner由独立compiled CLI输入私有JSON四字段email/password/displayName/organizationName，组织非空即拒绝、既有email不提升，用户/机构/OWNER/BOOTSTRAP_OWNER审计同事务；无HTTP bootstrap接口，不创建session或返回登录凭据。详见[P07-A任务](tasks/P07-A.md)及[运行说明](../ops/templates/README.md)。原公开/Overlay/管理/记分授权边界不变。
