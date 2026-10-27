# C15 待审方案：媒体上传与草稿创建的请求幂等

状态：**待 Codex 审查**，未实现；本轮不改后端、不写或执行 Migration。字节进度与分片上传是另一议题，不在本方案内。

## 问题

`POST /v1/orgs/{orgId}/matches/{matchId}/media-files` 和 `POST …/matches/{matchId}/media` 每次调用都生成新的 ID，没有请求身份。响应丢失时，客户端无法证明本次请求是否已保存。

- 同名、同大小、时间相近的文件或草稿不能作为证据：已有同名同大小的其他内容，或原请求稍后才完成，都会造成误判。
- 现行小程序（C15 修复后）只能“安全保留未知结果”：不自动重试，不允许新上传或创建草稿。候选记录交由组织者人工核对后结束。这不是幂等恢复。

## 请求身份

- 两个入口都新增必填 `clientRequestId`：客户端生成的 UUID v4，发送前持久化，重试时原样复用。
- 作用域为 `(org_id, actor_user_id, endpoint, scope_id)`，其中 `scope_id` 为 matchId（报名文件则为 entryId）。不同账号的同一 ID 互不相干，不能借此探测他人请求。
- 请求指纹：
  - 上传：`sha256(purpose, fileName, contentType, 内容sha256)`；
  - 草稿：`sha256(kind, title, fileId|externalUrl, rightsDeclaration)`。

## 数据模型（需新 Migration，另卡执行）

新表 `media_request_receipts`，字段如下：

| 字段 | 说明 |
|---|---|
| `org_id`、`actor_user_id`、`endpoint`、`scope_id`、`client_request_id` | 联合唯一 |
| `request_hash` | 请求指纹 |
| `result_type` | `FILE` 或 `MEDIA` |
| `result_id` | 指向生成的文件或媒体 |
| `created_at` | 创建时间 |

- 回执与被创建的文件或媒体在同一事务内写入。
- 保留期至少覆盖客户端最长重试窗口，建议 30 天。过期回执清理不得删除业务记录。

## 语义

| 情况 | 结果 |
|---|---|
| 新 ID | 正常执行；同事务写回执，返回 201 及结果 |
| 同 ID、同指纹，已有回执 | 不重复执行，返回 200 与原结果（文件/媒体当前 DTO），附 `replayed:true` |
| 同 ID、不同指纹 | 409 `IDEMPOTENCY_CONFLICT`，不执行，不泄露原内容 |
| 同 ID 并发 | 唯一约束串行化：后到者等待或冲突后读取回执，返回同一结果；绝不生成第二份 |
| 原结果后来被撤销/清除 | 重放返回该结果的当前状态（如 REVOKED），不新建 |

另增只读 `GET …/media-request-receipts/{clientRequestId}`，供客户端查询结果，与记分 `commands/:commandId` 同模式：

- 只返回本人在该作用域的回执；
- 不存在时返回 404 `RECEIPT_NOT_FOUND`，此时客户端仍须按“未知”处理，直到重放；
- 权限与原写入口相同；失去权限后返回 403，不泄露结果。

## 权限与事务

- 权限、赛事状态、额度与数量上限的判定都在回执检查之前，规则与现有入口一致。
- 重放不绕过当前权限：账号已无管理权时返回 403，而不是回放结果。
- 额度只在首次执行时扣减，重放不再计入。
- 锁序沿用现有：会话 → 机构 → 赛事 → 比赛。回执的唯一约束冲突在同一事务内转为“读取回执并返回”。

## 小程序接入（方案通过后）

- 发送前生成并持久化 `clientRequestId`（替代现有 pending 记录）。
- 结果未知时只做两件事：按 ID 查询回执，或以同 ID 原样重发；然后自动结束未知状态。
- 收到 `IDEMPOTENCY_CONFLICT` 时停止，并提示重新选择。

## 验收

- 同 ID 重放只存在一份文件或媒体；
- 不同内容复用同 ID 返回 409；
- 并发同 ID 只成功一次；
- 换账号用同 ID 互不影响；
- 失权后重放返回 403；
- 额度不重复计入。
