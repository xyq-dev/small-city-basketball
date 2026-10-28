# C19 交接：媒体请求幂等（B1）与有界分片上传（B2）

2026-10-28 Asia/Shanghai；负责人：Agent 媒体（Claude Code）。分支 `c19/media`（worktree `D:\Projects\scb-c19-media`，基于集成提交 `2eac213`）。状态：**本地实现与验证完成，待集成人合入**；未推送、未开 PR。

## 提交

| SHA        | 内容                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `3b87126`  | API：Migration 019、领域/服务/控制器、契约 `media-requests.d.ts`、领域单测、真实 PG 集成测试                                  |
| `868f357`  | 小程序：`utils/media-request.js`（新）、`pages/match-media` 改造、VM 测试、真实 API 页面闭环；按新行为更新 C15/C16 旧页面测试 |
| （本文件） | 交接文档                                                                                                                      |

说明：B1 与 B2 的服务端共用同一迁移、回执表与服务类（会话创建即占用 `MATCH_FILE_UPLOAD` 回执），在同一轮实现，B1 的回执/幂等测试全部通过后才提交；因此服务端与客户端各为一个提交，未再把 B1/B2 人为拆成四个提交。

## 实现摘要

### 服务端（`apps/api/src/media-request-*.ts`）

- 路由（前缀 `/v1/orgs/:orgId/matches/:matchId`，均为普通路由）：`POST/GET media-file-requests[/:clientRequestId]`、`POST/GET media-requests[/:clientRequestId]`、`POST media-upload-sessions`、`GET media-upload-sessions/:id`、`PUT …/:id/chunks/:index`、`POST …/:id/complete`、`POST …/:id/cancel`。首次执行 201，合法重放 200。
- 顺序：会话 → 机构锁 → 赛事 → 比赛权限（直接复用 `MediaService.access`：OWNER/ADMIN、本届 EVENT_MANAGER、STREAMER，未扩大或缩小）→ 回执 → 仅首次执行检查赛事可写、数量、额度、文件/受信主机前置条件。
- 无权响应：比赛对当前账号可见（机构有效成员，或在该届有任意 event_staff 记录）但无媒体权限 → 403 `FORBIDDEN`；否则 404。两者均在读回执之前判定，响应与回执是否存在无关（测试比对了错误体）。
- 指纹：`sha256(JSON.stringify(["v1", op, ...字段]))`，字段为**本接口实际写入的值**。新接口对文件名、标题、权利声明执行 `normalize('NFC')` 后再沿用原有 trim/长度规则；**旧 C05 校验只 trim、不做 NFC，本次未改动旧接口**。外部链接要求已是解析器 href 规范形式（小写主机、显式路径、无需转义字符），否则 422，故客户端无需复现 URL 规范化；受信主机检查属首次执行前置条件。
- 并发：上传类写入先取机构 `FOR UPDATE`（与旧上传一致），草稿取比赛 `FOR UPDATE`；回执 `INSERT … ON CONFLICT DO NOTHING RETURNING`，未返回行则整笔回滚并在新事务中重放（不在已中止事务中继续查询）。业务行、回执、额度、审计同事务；重放不追加业务审计。
- 分片会话：512 KiB 分片、末片实际长度、最多 16 片（8 MiB 上限不变）；24 小时有效，重放创建不续期；仅创建者且当前仍有权限可操作；同序同内容幂等、不同内容 409 `CHUNK_CONFLICT`；完成时校验分片齐全、总长度、整体 SHA-256，并对组装字节调用既有 `parseMediaUpload`（魔数/结构/图片尺寸规则不变）。完成事务：先把会话置 COMPLETED（`file_id` 外键 DEFERRABLE），再插入文件（额度触发器不再计入该会话预留），释放分片负载，回执写入 `result_file_id`，审计 `media.file.uploaded`。
- 同一请求编号不能产生两份文件：已有 OPEN 会话时整体上传 409 `UPLOAD_SESSION_ACTIVE`；会话取消/过期后整体上传 409 `REQUEST_CLOSED`；已整体上传的编号再建会话 409 `REQUEST_CLOSED`；会话完成后整体上传重放返回同一文件。
- 取消与完成竞争：两者都取机构 `FOR UPDATE` 与会话行锁，以先提交者为准；完成后取消 409 `UPLOAD_SESSION_COMPLETED`，取消后完成 409 `REQUEST_CLOSED`。
- 额度：触发器函数 `c05_media_file_guard` 由 019 `CREATE OR REPLACE`（015 未改），计入 OPEN 且未过期会话的声明字节；新会话触发器同样校验字节，并限制每机构 8 个、每用户每机构 2 个 OPEN 会话。服务层预检同口径（含文件名额：会话占 1 个文件名额）。
- 清理：`expireMediaUploadSessions(db, orgId|null, limit)`（导出函数，有界、`FOR UPDATE SKIP LOCKED`，只处理本模块 OPEN 且过期的会话：置 EXPIRED、分片负载置空）。在本机构的首次执行写路径内调用（每次至多 20 条）；也可由运维维护脚本以 `orgId=null` 调用。**没有后台定时任务，不宣称自动运行**；过期会话即使尚未被清理，其预留也已不计入额度（按 `expires_at` 判断）。已完成文件、回执从不被清理。

### 对既有文件的最小改动（`apps/api/src/media-service.ts`）

- `fileContext`、`access`、`fileDto`、`usage`、`itemDto`、`safeConfirmation` 由 `private` 放宽为 `protected`；导出 `MediaAccess` 类型。
- 新增 `protected reservations()`；旧 `upload()`（Web 与报名入口共用）的数量/字节预检加入 OPEN 会话的名额与预留字节，防止旧入口绕过预留。请求格式、响应与权限不变。

### 小程序

- `utils/media-request.js`：纯 JS SHA-256 / UTF-8 / base64，`fingerprint`、`normalizeText`（NFC+trim）、`canonicalLink`，记录存储 `scb.mediaRequests.v2`（每账号+机构+比赛一条未完成记录，上限 20，不淘汰），上传暂存 `USER_DATA_PATH/scb-upload-<id>.<ext>` + 登记 `scb.mediaUploadStaging.v1`（与预览的 `scb-media-` 前缀/登记完全分开）。
- `pages/match-media`：≤512 KiB 走 `media-file-requests`，更大走分片会话。发送前持久化编号与不可变元数据（含内容摘要），存储失败不发送；每个异步步骤后核验页面/账号/操作序号，换账号、退出、卸载后零写；结果未知先查回执（进入页面时对未知/无回执/会话状态的记录自动查询一次），404 只允许“按原编号原样重发”，且须重新读取本机文件并核对摘要；文件丢失或摘要变化不发送、不换编号；冲突只能结束记录；会话已取消/过期则结束记录并说明原编号不再使用。进度仅显示服务端回复中的 `receivedBytes`，分片全部确认后单独显示“最终文件校验”，只有最终 FILE 回执才显示成功。旧版 `scb.mediaPending.v1` 未知记录保留原人工核对路径，不查询回执、不伪装为幂等请求。

## 与真实代码的冲突及处理

1. 冻结契约写“无权 403”，而现有媒体工作台对非管理者一律 404：新接口按上述“可见则 403、否则 404”处理，权限集合与现有完全一致。
2. 旧校验没有 NFC：仅新接口执行 NFC，文档如实写明。
3. 外部链接的 URL 规范化客户端难以逐字复现：新接口改为要求输入已是规范形式（契约文件已注明）。
4. 契约 §2.2 的会话 DTO 字段有所增加：`clientRequestId、purpose、fileName、contentType、contentSha256、createdAt、closedAt`；新增错误码 `UPLOAD_SESSION_LIMIT`、`UPLOAD_INCOMPLETE`、`UPLOAD_DIGEST_MISMATCH`、`UPLOAD_SESSION_COMPLETED`、`RECEIPT_NOT_FOUND`。
5. C15/C16 旧页面测试（`c15-media-review`、`c15-native-management` 的 2 项、`c16-delivery` 的 1 项、`tests/wechat-api/native-management` 的丢失响应段）断言的是“无请求编号、只能人工核对”的旧行为，已被本任务明确替换；已改为断言新行为（同编号回执恢复、不重发、不换编号、存储失败不发送、20 条不淘汰等），保护强度不低于原断言；旧 v1 记录的人工核对用例保留。

## 需要集成人修改的共享文件

1. `packages/contracts/runtime-privileges.json`（运行时角色，无 DELETE）：
   ```json
   "media_request_receipts": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["result_file_id"] },
   "media_upload_sessions": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["status", "version", "closed_at", "closed_by", "file_id"] },
   "media_upload_chunks": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["payload", "released_at"] }
   ```
2. 表数 +3、Migration 数 +1（019）：readiness、privileges、backup/restore、restart/production 检查及 `c02-upgrade`、`p07-*` 计数断言。
3. `app.ts`、`request-body.ts`、`api.js` 白名单：**无需修改**（预接线已覆盖全部路由与两条上传通道）。`app.json` 无新页面。
4. 可选：若有既有运维维护脚本，可调用导出的 `expireMediaUploadSessions(pool, null, 500)`；未接入时清理只在请求路径内有界进行。

## 执行的检查（均在本 worktree）

| 命令                                                                                                                | 结果                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                                                                 | 通过                                                                                                               |
| `cd apps/api && npx vitest run src/media-request-domain.test.ts`                                                    | 5/5                                                                                                                |
| `cd apps/api && npx vitest run src`（全部 API 单测）                                                                | 545 中 541 通过；4 失败均为既有 Windows 基线 `account-maintenance.test.ts`                                         |
| `TEST_DATABASE_URL=… npx vitest run test/c19-media-requests.integration.test.ts`（真实 PG 18）                      | 12/12                                                                                                              |
| `TEST_DATABASE_URL=… npx vitest run test/c05-media.integration.test.ts test/c19-media-requests.integration.test.ts` | 19/19（旧媒体回归通过）                                                                                            |
| `node --test apps/wechat/test/c19-media-requests.test.cjs`                                                          | 9/9                                                                                                                |
| `npm run test:wechat`                                                                                               | 559 中 555 通过；4 失败为既有 Windows 基线（fulfillment/booking 夹具路径 2、public media 夹具 1、symlink EPERM 1） |
| `npm run build --workspace @small-city-basketball/api` 后 `TEST_DATABASE_URL=… npm run test:wechat:api`             | 5/5（含新 `c19-media.test.mjs` 与更新后的 `native-management`）                                                    |
| `npx prettier --check …`（本次全部改动文件）、`git diff --check`                                                    | 通过                                                                                                               |

真实 PG 覆盖：并发同 ID 只一份文件/额度计一次/审计一次；不同内容 409 且不泄露原内容；换账号/换比赛独立作用域；失权 403（回执存在与否响应相同）、外部账号 404、恢复权限后重放原结果；撤销/清除后、额度已满、赛事归档后重放返回当前状态且不新建；会话断点续传、同序幂等/冲突、完成后重放与查回执一致、整体上传与分片不能产生两份文件；预留阻止整体/旧入口/新会话上传，DB 触发器直接 INSERT 也被拒；取消与过期释放预留并置空分片、原编号永久关闭；每用户 2 / 每机构 8 个会话上限（服务与触发器）及“多会话绕过额度”被拒；取消与完成竞争 4 轮按事务结果一致；非创建者 404、失权 403；审计失败整体回滚后同 ID 再执行一次；回执/会话不可删除或改写。

真实 API 页面闭环（`tests/wechat-api/c19-media.test.mjs`）：真实 match-media 页面 → 真实 API → 隔离 PG：整体上传丢失响应后经同编号回执恢复（DB 一份文件、一条回执、一条审计）；草稿丢失响应经回执恢复；3 片视频在第 2 片回复丢失并离开页面，重新进入后显示服务端已确认 1 MiB，继续只补发剩余分片并完成（会话 COMPLETED、一份文件、每片审计各一次、分片负载已释放、下载字节一致、暂存文件已删除）；换账号清空页面。

## 未执行 / 未验证

- 微信开发者工具、真机未运行（本模块无工具验证；VM 与真实 API 闭环不等于微信运行时）。
- `c02-upgrade`、`p07-*` 集成测试未运行：新增 3 表必然使其计数断言失败，待集成人更新计数。
- 未在生产或任何非隔离环境执行 Migration。
- 2026-10-28 中断保全：会话过期判定从 `clock_timestamp()` 改为事务时间 `now()`，完成/取消在过期窗口用 `RETURNING` 避免 500；新增集成测试未在本轮重跑。状态为 WIP，未宣称完成。
- 纯 JS SHA-256 在本机 Node 上 8 MiB 约 0.34 s，手机端耗时未实测。

## 审查关注点

- 权限：403/404 判定新增“可见性”查询（机构成员或该届任意 staff 记录）；权限集合本身复用 `access()`。
- DB：`c05_media_file_guard` 被替换（函数体除额度一行外与 015 相同）；会话 `file_id` 外键为 DEFERRABLE；测试中时间旅行/归档夹具使用超级用户 `session_replication_role=replica`，非应用路径。
- 并发：上传、建会话、完成、取消均取机构 `FOR UPDATE`，同机构上传串行化（与旧上传一致）；分片写只取机构 SHARE + 会话行锁。
- 恢复：本机“结束此记录”只结束本地记录，服务端未完成会话按到期失效；换账号不会用新账号清理旧账号的服务端会话。
