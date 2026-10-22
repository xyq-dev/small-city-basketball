# API 契约

目标契约：v0.2；更新：2026-10-22。P01、P02已整合main，P02身份／机构／赛事API及真实PostgreSQL验收通过；PR #2整合提交29c4ee4。以下通用目标路由中P03–P06仍为规划；本轮实际边界见第5节。

## 1. 通用约定

- 私有路由前缀 `/v1/orgs/{orgId}`，每次验证登录身份、资源归属及具体动作权限。工作人员还验证机构成员状态和赛事分配；领队/球员验证球队授权、本人绑定或有效邀请，不要求成为机构工作人员。路径 orgId 不构成授权。未知或跨租户资源返回 404；已可见资源但无动作权限返回 403。
- JSON 成功响应 `{data, meta:{requestId}}`；列表为 `{data:[],meta:{requestId,nextCursor}}`。游标分页默认 `limit=20`、最大100；允许的筛选/排序由各路由白名单限定，不能接收任意 SQL 字段。
- 错误响应 `{error:{code,message,requestId,details?}}`；details 不回显证件、密钥及内部查询。401 未认证；403 无权限；404 资源不可见；409 并发/幂等/租约冲突；422 字段或业务守卫失败；429 限流。
- 修改已有资源发送 `expectedVersion`，成功响应返回新 `version`。记分及其他需防重复命令发送 `Idempotency-Key`；同作用域同键同载荷返回原结果，同键不同载荷返回 `IDEMPOTENCY_CONFLICT`。即使重放也重新认证、授权，不返回已失去权限的历史响应。
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

除P02已实现路由外，下表仍是长期目标；P03-A尚未开工。实际P02权限与输入以第5节和共享契约为准，不推定报名、保险文件或邀请已可调用。

下表私有路径均省略 `/v1/orgs/{orgId}`；资源 ID 需按其所属赛事/机构重新校验。

| 方法与路径 | 作用 | 最低授权/阶段 |
|---|---|---|
| GET/POST `/events`；GET `/events/{eventId}` | 列表、创建草稿、详情 | 按授权赛事范围读取，列表也裁剪范围；有机构创建权限者建草稿；P02 |
| PATCH `/events/{eventId}` | 编辑草稿 | EVENT_MANAGER，版本匹配且 DRAFT；P02 |
| POST `/events/{eventId}/commands` | 开报名/关报名/发布赛程/结束/归档 | 对应管理动作与状态守卫；P03起 |
| GET/POST `/teams`；PATCH `/teams/{teamId}` | 长期球队资料 | 管理者或被授权的本队领队；P03 |
| POST `/teams/{teamId}/invitations` | 创建有用途和范围的球队/球员邀请 | 本队领队或授权工作人员，仅允许授予自身可授予的资源权限；P03 |
| POST `/events/{eventId}/entries` | 建立球队参赛草稿 | TEAM_MANAGER 或管理者；P03 |
| PUT `/entries/{entryId}/players` | 更新本届名单 | 本队领队，版本和名单锁定检查；P03 |
| GET/PATCH `/participants/{playerId}/profile` | 读取/补充本人参赛资料 | 本人绑定；领队仅在赛事规则允许的受托字段范围内代填，不能默认读取全部证件；P03 |
| POST `/entries/{entryId}/commands` | 提交/撤回/审核/退回补齐 | 领队或独立 REVIEWER 按具体命令；P03 |
| POST `/participants/{playerId}/insurance-evidence` | 登记受控上传凭证引用 | 本人/本队领队；P03 |
| POST `/insurance-evidence/{evidenceId}/review` | 审核凭证 | REVIEWER；P03 |
| POST `/events/{eventId}/draws` | 分组抽签或有理由的重抽 | EVENT_MANAGER，记录输入与结果；P04 |
| POST `/events/{eventId}/schedule-revisions` | 生成或调整赛程草稿 | EVENT_MANAGER；P04 |
| POST `/schedule-revisions/{revisionId}/validate` | 检查约束并返回冲突 | EVENT_MANAGER；P04 |
| POST `/schedule-revisions/{revisionId}/publish` | 发布新赛程版本 | EVENT_MANAGER，验证通过；P04 |
| POST/DELETE `/matches/{matchId}/scorekeeper-lease` | 获取/释放主记分租约 | 被分配 SCORER；P05 |
| POST `/matches/{matchId}/scorekeeper-lease/renew` | 续约 | 同主记分端及栅栏版本；P05 |
| POST `/matches/{matchId}/commands` | 开始/事件/校时/撤销/结束计分 | SCORER，租约、幂等、状态、版本；P05 |
| POST `/matches/{matchId}/result-confirmations` | 确认当前版本赛果 | EVENT_MANAGER 或指定确认人；P05 |
| POST `/matches/{matchId}/reopen` | 重开已确认赛果 | 特定管理权限，理由必填；P05 |
| POST `/matches/{matchId}/broadcast-sessions` | 绑定本场直播会话 | STREAMER；P06 |
| POST `/broadcast-sessions/{sessionId}/overlay-grants` | 签发只读包装授权 | STREAMER；P06 |
| POST `/overlay-grants/{grantId}/revoke` | 撤销包装授权 | STREAMER/机构管理员；P06 |

全局身份路由单独使用 `GET /v1/me`、`GET /v1/me/organizations`（工作人员上下文）、`GET /v1/me/team-contexts`（本人球队/参赛上下文）。它们只返回本人可进入的范围，不因参加赛事而获得机构后台权限。

`POST /v1/invitations/{invitationId}/accept` 是已登录受邀者接受邀请的独立入口；验证令牌hash、有效期、用途、目标受邀者和未被消费状态，事务内建立限定资源绑定并记录接受，不能凭客户端给出的userId绑定他人。重复接受仅向同一已核验身份返回既有结果；撤销、过期、越范围的邀请拒绝。机构工作人员的邀请/撤权和平台套餐开通接口在 P02/P06 对应任务细化，不从本路由表推定已经实现。文件上传另设授权申请/完成接口，下载临时链接须重新鉴权，URL 不能永久公开。

公开路由为 `/v1/public/events/{publicId}`、其 `/schedule`、`/standings`，及 `/v1/public/matches/{publicId}/snapshot`。仅返回已发布可见内容。包装读取 `/v1/overlays/{grantId}/snapshot` 和 `/stream`，使用独立只读能力令牌，不复用机构管理会话。

## 4. 比赛命令和冲突

统一命令包包含 `commandId`、`expectedVersion`、`leaseId`、`fencingToken`、`type`、`payload`、`capturedAt`。事件类型按统计模式限制：基础模式可记球队得分、犯规、暂停、节次及计时；专业模式增加球员命中/出手、篮板、助攻、抢断、盖帽及失误。一次球员命中事件同时产生球队和球员得分投影，不能再额外发送一次球队加分。未指定球员的基础得分不能伪造个人数据。

撤销传原事件 ID，服务器校验可补偿性；结束计分只进入 PENDING_CONFIRMATION。确认必须引用精确的 matchVersion；有新写入时拒绝旧确认。重开后既有确认版本保留，公开投影标明结果待重确认。

关键错误码：`VALIDATION_ERROR`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`LEASE_REQUIRED`、`LEASE_EXPIRED`、`LEASE_HELD_BY_OTHER`、`INVALID_EVENT_STATE`、`INVALID_MATCH_STATE`、`ROSTER_LOCKED`、`RULE_CONFLICT`、`RESULT_RECONFIRMATION_REQUIRED`、`OVERLAY_GRANT_EXPIRED`。409 返回当前可读版本及可重取快照信息，不自动覆盖；客户端不能无限重试业务冲突。

实时消息包含 `matchId`、`version`、`serverTime` 和有限投影。可采用 SSE 或 WebSocket，选型在 P05 定稿；有缺口、重连或模式变化时重拉完整快照。视频及 OBS 能力不成为记分命令成功的前置条件。

## 5. P02 已整合契约

P02状态DONE / MAIN，范围已通过真实数据库和API浏览器验收；CI及交接见[TESTING](TESTING.md)。使用 `packages/contracts` 的SessionData/EventData。事件字段沿P01，私有API的每个赛事额外返回 `permissions:{canEditDraft:boolean}`，依据该场真实授权及DRAFT计算；Mock允许省略。机构EVENT_MANAGER可能只分配某场SCORER，因此前端不能用全局角色推断编辑权；服务端再次执行动作授权。

| 方法与路径 | 输入/响应与权限 |
|---|---|
| POST `/v1/auth/register` | `{email,password,displayName,organizationName}`，201返回SessionData并建会话；机构初始OWNER。生产默认关闭自主注册，没有邮箱验证/微信身份声明 |
| POST `/v1/auth/login` | `{email,password}`，200返回SessionData并轮换浏览器Cookie；错误登录401通用文案 |
| GET `/v1/auth/session` | `{user:{id,email,displayName},organizations:[{id,name,role}]}`，仅本人当前有效范围 |
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

## 6. P03-A Web报名实施契约（LOCAL_ONLY，尚未验收）

共享类型已在 `packages/contracts/index.d.ts` 落地；API及合同源码已发布于[PR3首个代码提交dac9ebc](https://github.com/xyq-dev/small-city-basketball/commit/dac9ebcffb69eca7f01fee9133ccb310e4c37f31)。首轮43项真实PG及重启验证通过，真实API浏览器仍待验收，不属于当前main已完成能力。下列业务路径均在 `/v1/orgs/{orgId}` 下，身份及接受邀请入口除外。

| 方法与路径 | 行为与授权 |
|---|---|
| POST `/v1/auth/register-participant` | email/password/displayName；只创建User+Session，没有机构或工作人员成员；返回SessionData |
| GET `/v1/auth/session` | P03新增teamContexts，和organizations分别返回；不因接受邀请获得机构后台权限 |
| GET/POST `/teams`；GET/PATCH `/teams/{id}` | OWNER/ADMIN创建，初始不自动授领队；工作人员管理范围与当前本队领队分别校验 |
| PUT `/teams/{id}/members` | `{expectedVersion,members:[{id?,name}]}`；最多60人，新人服务端生成id，移出归档，旧报名快照不变 |
| GET/POST `/teams/{id}/invitations` | 仅OWNER/ADMIN签发明确existing targetUserId；expiresInHours整数1–168；创建一次返回`{invitation,token}`，读取不返回token/hash |
| POST `/teams/{id}/invitations/{inviteId}/revoke`；PUT `/teams/{id}/grants/{userId}` | OWNER/ADMIN分别撤销未消费邀请或改grant ACTIVE/DISABLED；撤销邀请不代替停用已接受的授权 |
| POST `/v1/invitations/{id}/accept` | 已登录明确target，body仅token；检查用途/hash/期限/撤销/邀请人当前资格；已消费不能复活后来停用的grant |
| GET `/teams/{id}/registration-events` | 领队可见已开放赛事及本队已有报名；不泄露其他球队名单或未公开草稿 |
| GET `/events/{id}/registration` | 授权工作人员读取event/rules/counts/freeze/capabilities |
| PUT `/events/{id}/registration-rules` | DRAFT及赛事管理权，expectedVersion为event.version；人数上下限、0/00规则、是否要求身份/保险，追加不可变规则版本 |
| POST `/events/{id}/registration-commands` | OPEN_REGISTRATION / CLOSE_REGISTRATION / FREEZE_REGISTRATION，CAS及具体状态守卫；不支持任意改状态 |
| GET/POST `/events/{id}/entries`；GET `/entries/{id}` | 工作人员范围或本队grant范围读取；创建仅有效领队、OPEN、同赛事同队唯一 |
| PUT `/entries/{id}/roster` | expectedVersion+memberId/jerseyNo；从当前有效本队成员快照姓名，始终新建不可变revision |
| POST `/entries/{id}/commands` | SUBMIT/WITHDRAW/APPROVE/REQUEST_CHANGES/REJECT，CAS；退回及拒绝reason1–500必填 |

列表默认20、最多100，nextCursor绑定当前用户/机构/资源/筛选。UI逐页读取，后页失败整个读取报错；动作依赖每资源capabilities并由服务器再次守卫。

规则minPlayers1–60，maxPlayers不低于min且不超过60。号码仅0、00、1–99，零号等价性按锁定规则检查。要求身份或保险为true时阻止开放，不能因本卡未接供应商而自动豁免。

提交名单只读；审核者不得是当前领队或lastSubmittedBy，OWNER也不例外。APPROVED修改先被独立审核者退回，再保存新revision并重提。CLOSED仅CHANGES_REQUESTED可补交，保存保持该状态；DRAFT不能关闭后新提交。REJECTED/WITHDRAWN终态，不隐式重建。

冻结要求CLOSED、至少2批准、没有SUBMITTED/CHANGES_REQUESTED。DRAFT/REJECTED/WITHDRAWN排除数显式返回；服务端查询批准revision生成不可变freeze，客户端不能提供名单清单作为权威。冻结后停止全部报名与审核写入，不自动发布赛程。邀请token只在URL fragment传递并在读取后移除，不进入localStorage。
