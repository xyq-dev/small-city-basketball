# 公开赛事目录方案（C13 提出；C18 首版实现）

2026-10-26 Asia/Shanghai 提出。2026-10-28：经审查后由 [C18](../tasks/C18.md) 按审定规则实现首版（Draft PR，未合并、未部署）。下文“实施订正”优先于原草案；原草案保留作历史依据。

## 实施订正（C18，2026-10-28）

- **游标**：base64url 编码 `{v, s, c, d, k}`（格式版本、分组、规范化城市、排序日期、publicEventId），**不做 HMAC**。游标只含公开字段，篡改、格式错误或与当前筛选（分组、城市）不一致时返回 400 `INVALID_CURSOR`。不存在“跨机构游标”：目录本身跨机构，游标不携带机构信息，因此原验收中的“跨机构游标拒绝”改为“游标与筛选绑定”。
- **缓存**：匿名目录 `Cache-Control: no-store`（不采用待审包中的 `max-age=30`），撤出后下一次读取即不可见。
- **唯一性**：每个 `(org_id, event_id)` 至多一条 ACTIVE（部分唯一索引）；条目只能 ACTIVE→REVOKED，不复活、不删除，重新列入插入新行。
- **分组**：LIVE = RUNNING + LIVE；UPCOMING = SCHEDULED + LIVE；HISTORY = COMPLETED/ARCHIVED + HISTORY；只从状态与授权用途推导，不按日期猜测。列入时状态必须与授权用途一致；ARCHIVE 保留 HISTORY 条目。
- **自动撤出**：公开授权 `revoked_at` 由空变非空（DISABLE、完赛、重新开放、发布新轮次、隔离批次）由数据库触发器在同一事务撤出，来源 `PUBLICATION_REVOKED`；机构 ACTIVE→DISABLED 撤出，来源 `ORGANIZATION_DISABLED`、操作者为空（系统原因，不伪造用户，不放宽 `audit_logs`）。自动撤出不再推进赛事版本；机构重新启用或重新开启公开观赛均不自动恢复。
- **审计与并发**：LIST/UNLIST 需 4–500 字原因与 `expectedEventVersion`，同事务推进赛事版本并写审计；加锁顺序 身份 → 机构 → 赛事 → 公开授权 → 目录条目。
- **匿名读取**：每次读取都联结机构（ACTIVE）、赛事与公开授权（未撤销），不只看目录表。同一可信客户端 IP 每分钟 60 次（复用现有限流表）。不读取、不设置 Cookie。
- **字段**：城市 trim 后 1–20 字，仅中文、字母、数字、空格与“·”，筛选按规范化值精确匹配。

## 背景

观众目前只能通过主办方提供的43位观赛键进入公开赛事（P05-B），小程序“赛事”页无法列出任何公开赛事。[商业规划](../COMMERCIAL_PRODUCT_PLAN.md)已规定“目录、公开球员页仍需独立白名单与发布规则，不自动公开私有赛事”。

## 业务规则

1. **单独授权**：赛事进入目录需主办方管理员或该届实际 EVENT_MANAGER 执行显式命令 `LIST_IN_DIRECTORY`；启用公开观赛（ENABLE/ENABLE_HISTORY）**不**自动进入目录。
2. **前置条件**：存在当前有效的公开观赛发布（status=ACTIVE，purpose=LIVE或HISTORY）；机构处于活跃状态。
3. **撤出**：`UNLIST_FROM_DIRECTORY` 任何状态可用；公开观赛被 DISABLE、完赛/重新开放导致旧公开键失效、机构停用时，目录条目同事务失效，不能留下指向失效公开键的条目。
4. **字段白名单**：只含现有 PublicEventData 已公开的字段子集（publicEventId、name、startDate、endDate、venueName、status、purpose）及主办方填写的展示城市（可空）。不含机构内部ID、工作人员、名单或联系方式。
5. **审计**：上架/下架记录操作者、时间、原因（4–500字）与赛事版本，沿用现有 CAS + audit 同事务。

## 数据模型（草案）

`event_directory_listings`：`id uuid pk`、`org_id`、`event_id`、`publication_id`（引用当前公开发布）、`display_city text null`、`status ACTIVE|REVOKED`、`created_by`、`created_at`、`revoked_at`、`revoke_reason`。约束：每个 `(event_id)` 至多一条 ACTIVE；`publication_id` 必须属于同一 event 且 ACTIVE。需要新 Migration（018，待审）。

## API（草案）

- 私有：`POST /v1/orgs/:orgId/events/:eventId/directory-commands`，`{type:'LIST'|'UNLIST', expectedEventVersion, displayCity?, reason}`；权限与公开观赛命令一致；返回目录状态。
- 匿名：`GET /v1/public/directory?limit=20&cursor=&status=LIVE|UPCOMING|HISTORY&city=`；不读取Cookie；游标仅含公开字段；每条只返回白名单字段与 publicEventId，详情仍走现有 `/v1/public/events/:publicEventId`。
- 小程序：赛事页“公开赛事”分区调用匿名目录；无条目时显示“暂无主办方公开的赛事”。

## 验收条件

真实PG：未上架不可见；上架后可见；DISABLE/完赛/REOPEN/机构停用后同一读取立即不可见；跨机构游标拒绝；字段白名单快照测试；并发上架/撤销CAS；撤销后旧公开键404。浏览器与小程序：空目录、分页、撤销后刷新清空。

## 风险

公开范围扩大属于“公开授权”变更，须独立安全审查；不得在本方案审查前以前端过滤或硬编码列表替代。
