# API 契约

目标契约：v0.1；更新：2026-10-22；状态：未实现。P01 使用本地 Mock adapter，本文路由不是已经可调用的服务；之后由相同 DTO 和用例语义替换 adapter。

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
// 返回 EventSummary/EventDetail，含 id、上述字段、status:'DRAFT'、version、createdAt、updatedAt。
```

`name` 去首尾空白后必填，长度1–80字符；`startDate/endDate` 必填且日期有序；`timezone` 在 P01 固定为 `Asia/Shanghai`；`format` 必填且在枚举内。`venueName` 可选，去首尾空白后最长100字符，空白或缺省归一为未设置；读取 DTO 使用 `venueName: string | null`，UI 对 null 显示“待定”。长度与显示文案跟随 [UI 规格](UI_SPEC.md)。服务端上线后重复执行相同业务校验；Mock 中的权限标签不是安全验收。创建只产生草稿，不能从表单直接发布、收费或开放报名。

## 3. 目标路由清单

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
