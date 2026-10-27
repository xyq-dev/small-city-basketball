# C15 待审方案：比赛媒体上传与草稿创建的请求幂等（修订版）

状态：**待 Codex 复审**，未实现；不改后端、不写或执行 Migration。字节进度与分片上传另行安排，不在本方案内。

本版按 PR #24 描述中的方案审查订正。

## 问题与现状

- `POST /v1/orgs/{orgId}/matches/{matchId}/media-files`（上传）与 `POST …/matches/{matchId}/media`（草稿）每次调用都生成新 ID，没有请求身份。
- 小程序现行行为是**安全保留未知结果**，不是幂等恢复：
  - 发送前在本机存储写入待处理记录，写不进去就不发送；
  - 响应丢失时保持“未知”，禁止重试、新上传与新草稿；
  - 候选记录交由组织者人工核对后，才能结束这条记录。

## 1. 范围与兼容

- 首期只覆盖**比赛媒体**的上传（`MATCH_IMAGE`、`MATCH_VIDEO`）与草稿创建；报名文件上传不在首期。
- 采用**新增入口**，不修改旧入口的请求格式：
  - `POST …/matches/{matchId}/media-files:idempotent`
  - `POST …/matches/{matchId}/media:idempotent`

  两个入口都要求 `clientRequestId`（UUID v4），其余字段与旧入口相同。
- 旧入口（现有 Web、旧版小程序、报名上传）完全不变，**不承诺幂等**，也不新增必填字段。新版小程序改用新入口；旧版继续“安全保留未知”。

## 2. 校验顺序（同一事务内）

1. 会话有效（沿用现有新鲜会话检查）。
2. 当前身份对该机构、比赛的权限：上传或创建草稿须有管理权。权限不足返回 403，**不查回执、不泄露回执是否存在**。
3. 查回执（见第 4 节），并比较规范化指纹：
   - 命中且指纹相同：返回原结果；
   - 命中但指纹不同：返回 409 `IDEMPOTENCY_CONFLICT`。
4. **仅首次执行**才检查：赛事可写状态（未归档、未取消）、数量上限、机构额度、文件或媒体前置条件。

合法回放不受第 4 步约束：额度已满、赛事已归档、结果已撤销或清除时，回放仍返回原结果的当前状态，不新建，也不因首次条件被拦截。

## 3. 回执保留

- 首期回执**不自动过期、不删除**。
- 将来如需清理，只能删除业务快照字段，必须保留 `(作用域, client_request_id, operation, request_hash)` 墓碑，禁止旧 ID 重新执行。
- “30 天后删除、同 ID 可重建”的做法**不可接受**。

## 4. 数据与事务

新表 `media_request_receipts`，字段如下：

| 字段 | 约束 |
|---|---|
| `org_id`、`actor_user_id`、`match_id` | 作用域 |
| `operation` | `CHECK (operation IN ('MATCH_FILE_UPLOAD','MATCH_MEDIA_CREATE'))` |
| `client_request_id` | uuid |
| `request_hash` | 规范化指纹（第 5 节） |
| `result_file_id`、`result_media_id` | 按 `operation` 二选一非空：`CHECK` 加外键，结果归属与类型由数据约束保证 |
| `created_at` | — |

- 唯一约束：`UNIQUE (org_id, actor_user_id, match_id, operation, client_request_id)`，包含操作类型。
- 并发：首次执行时先持有既有锁序（会话 → 机构 → 赛事 → 比赛 `FOR UPDATE`），在锁内先 `SELECT` 回执。
  - 不存在时执行业务插入，并以 `INSERT … ON CONFLICT DO NOTHING RETURNING` 写回执；
  - 若回执写入未返回行（并发者已写入），整笔事务回滚，改为在新事务中读取回执返回。
- **不在已因 unique violation 中止的事务里继续 SELECT**；如需局部恢复，用保存点 `SAVEPOINT` 回滚到冲突前。
- 查询入口区分类型：
  - `GET …/matches/{matchId}/media-files:receipts/{clientRequestId}`
  - `GET …/matches/{matchId}/media:receipts/{clientRequestId}`

  两者的权限与写入口相同；返回原结果的当前 DTO，或 404 `RECEIPT_NOT_FOUND`（客户端此时仍按“未知”处理，只能用同 ID 原样重发）。

## 5. 指纹与客户端不可变内容

- 指纹为带版本的规范化 JSON 元组，字段顺序固定，SHA-256 编码：
  - 上传：`["v1","MATCH_FILE_UPLOAD",purpose,fileName,contentType,byteLength,contentSha256]`
  - 草稿：`["v1","MATCH_MEDIA_CREATE",kind,title,fileId|null,externalUrl|null,rightsDeclaration]`

  字符串按 NFC 规范化并去首尾空白（与现有校验一致），不做其他改写。
- 客户端在发送前持久化 `clientRequestId`、上述不可变元数据与内容 SHA-256。重发前重新读取临时文件，并核验字节摘要与原记录一致。
- 临时文件丢失、摘要不符，或服务端返回 `IDEMPOTENCY_CONFLICT` 时：**保留原未知记录**，只能查回执或人工核对，**不得**提示换文件或生成新 ID 来绕过未知保护。

## 验收

- 同 ID、同内容重放：服务端只存在一份文件或媒体，额度只计一次，回放返回原结果的当前状态（含 REVOKED、PURGED）。
- 同 ID、不同内容：返回 409，不执行，不泄露原内容。
- 并发同 ID：只成功执行一次，其余请求得到同一结果；数据库中无第二条业务记录，无已中止事务被继续使用。
- 换账号或换比赛使用同 ID：互不影响。
- 失权后回放：返回 403，不泄露回执是否存在。
- 额度已满、赛事归档、结果已撤销时：合法回放仍成功返回原结果，不新建。
- 回执不自动删除；旧 ID 永不重新执行。
- 旧入口行为与响应完全不变；报名上传不受影响。
- 客户端：临时文件丢失或摘要不符时不发送、不换 ID，未知记录保留。
