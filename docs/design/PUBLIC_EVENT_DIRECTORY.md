# 公开赛事目录方案（C13，待Codex审查，未实现）

2026-10-26 Asia/Shanghai。状态：**PROPOSAL**。不改数据库、不新增API，直到本方案通过审查并另开实施卡。

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
