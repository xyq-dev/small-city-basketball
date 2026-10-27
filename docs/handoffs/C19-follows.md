# C19 赛事关注（Agent 关注）交接

2026-10-28 Asia/Shanghai；分支 `c19/follows`（worktree `D:\Projects\scb-c19-follows`，基于集成提交 2eac213）。状态：**本地完成，未推送**；Migration 021 **已编写**，仅在本任务隔离库（127.0.0.1:55433，测试工具自建/自删子库）执行过，未在任何正式环境执行。

## 1. 实现摘要

| 层        | 文件                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| Migration | `apps/api/migrations/021_c19_event_follows.sql`（新表 `event_follows`）                   |
| 契约      | `packages/contracts/event-follows.d.ts`                                                   |
| 后端      | `apps/api/src/event-follow-{domain,service,controller}.ts`、`event-follow-domain.test.ts` |
| 真实 PG   | `apps/api/test/c19-event-follows.integration.test.ts`                                     |
| 小程序    | `apps/wechat/utils/follows.js`、新页面 `pages/follows/*`、`pages/event/*`（关注区块）     |
| 测试      | `apps/wechat/test/c19-follows.test.cjs`、`tests/wechat-api/c19-follows.test.mjs`          |
| 文档      | 本文件、`docs/design/C19_FOLLOW_NOTIFICATIONS.md`（未来通知草案，未实施）                 |

路由（与冻结 §4 一致）：`POST /v1/me/follows`（首次 201、重复 200 同一 followId）、`GET /v1/me/follows?limit=&cursor=`、`GET /v1/me/follows/lookup?publicEventId=`（`data` 为 `FollowData | null`）、`POST /v1/me/follows/:followId/cancel`（空体或 `{}`）。

## 2. 关键规则

- **服务端公开可读检查**：关注时在同一事务内复用匿名公开读取的闸门 `publicAccess`（机构 ACTIVE、赛事格式受支持、发布未撤销、赛事状态与 LIVE/HISTORY 用途匹配），并对机构/赛事/发布行 `FOR SHARE`；不信任前端曾打开过。未知、已撤销、机构停用、用途不符一律相同 404 `RESOURCE_NOT_FOUND`（测试比对错误体完全一致）。
- **绑定公开发布身份**：`event_follows.publication_id` → `public_event_publications`（复合外键含机构、赛事）。部分唯一索引 `(user_id, publication_id) WHERE status='ACTIVE'` + `INSERT … ON CONFLICT DO NOTHING` 实现幂等；并发 6 次重复请求只产生 1 行、1 条审计。
- **状态**：库内只存 `ACTIVE/CANCELLED`；`INVALID` 每次读取时由当前公开可读性派生，`event` 只在 ACTIVE 时返回白名单 `{name,startDate,endDate,status,purpose}`，INVALID/CANCELLED 为 `null`。撤销不可逆，因此撤销后的关注永久 INVALID；重新开启产生新公开键，旧关注不迁移、不继承。
- **目录 UNLIST 不影响关注**（分享链接仍有效），测试覆盖。
- **取消**：只按 `id + 本人 user_id` 锁行，不要求发布仍有效；重复取消幂等（返回同一 CANCELLED 结果、不重复审计）；他人关注与不存在的 ID 同样 404。
- **我的关注**：只读本人 ACTIVE/INVALID 行，`(created_at DESC, id DESC)` 键集分页，游标保留微秒并要求重编码一致；同一时间戳不重不漏（真实 PG 验证）。
- **审计**：`follow.created` / `follow.cancelled` 与业务行同事务，`org_id = NULL`（个人行为，不进入机构审计视图，主办方看不到谁关注）；审计失败整体回滚（测试注入触发器验证）。
- **触发器**（调用者权限，无 SECURITY DEFINER）：禁止 DELETE/TRUNCATE；INSERT 必须 ACTIVE 且父链当前可读；UPDATE 只允许 ACTIVE→CANCELLED 且只改 `status/cancelled_at`。
- **限流**：关注写入按会话 30 次/分钟（复用 `auth_rate_limits`，键 `follow:<会话令牌哈希>`）。
- **微信提醒**：本轮不调用发送、不伪造模板/授权/送达/worker。`FollowData.wechatReminder` 恒为 `'NOT_ENABLED'`；页面“关注成功”与“微信提醒未启用”分行显示。

### 小程序

- 公开赛事页：公开读取代码未改（未登录时与现在一样不带 Cookie）；未登录只显示“登录后关注”，不发任何 `/v1/me/` 请求。登录后首次读取成功才查询 lookup。
- 关注/取消都走 `ui.confirmOp`；关注确认后先异步准备（再次 lookup，已关注则不写），每个异步步骤后检查确认令牌、页面代际与卸载状态；账号切换、退出、卸载、迟到确认、准备期间失效均零写请求（VM 测试断言实际请求）。
- 任何会话变化通过 `onSessionReset` 只清空关注区块（公开赛事资料保留），再为新账号重新 lookup。
- `pages/follows`：会话变化立即清空列表与游标，再读新账号；后续页失败保留已读行并用同一游标重试；刷新/切换清除 `loadingMore`；INVALID 行不显示原资料、不可打开旧链接，只能取消；对服务端返回“INVALID 却带赛事资料”的响应拒绝渲染。

## 3. 与真实代码的冲突及处理

1. 冻结契约 `FollowData` 没有提醒字段，而总任务要求“响应与页面”分开表达：**追加** `wechatReminder: 'NOT_ENABLED'`（只增不改，需集成人在 C19 任务卡记录）。
2. 契约写 `{follow|null}`：实现为 `data: FollowData | null`。
3. `apps/wechat/utils/ui.js` 的 `routes` 没有 `follows`：本模块未改 ui.js，页面内用 `wx.navigateTo('/pages/follows/index')`；`ui.login('/pages/follows/index')` 当前会被 `safeReturn` 丢弃返回地址（只回到账号页）。
4. `ui.subscribe` 在会话通知遍历 Set 期间重新订阅会导致同一轮再次回调（无限循环）；follows 页在 `onSessionReset` 中把重新读取推迟到微任务规避，未改 ui.js。
5. 旧测试替身客户端没有 `hasSession()`：赛事页按能力检测，缺失视为未登录。
6. 机构停用时关注读取为 INVALID；机构恢复且发布未撤销时恢复 ACTIVE（与公开链接恢复可读一致）。如需改为“停用即永久失效”，需在任务卡决策后加持久终态。

## 4. 需要集成人修改的共享文件（本模块未改）

- `apps/wechat/app.json`：`pages` 增加 `"pages/follows/index"`。注册前 `native-structure.test.cjs` 的 “native template and static event targets: pages/event/index” 会因 `Unregistered literal route: /pages/follows/index` 失败（注册后消失）；`c19-follows.test.cjs` 在未注册时用临时副本预览，注册后自动用真实根目录。
- `apps/wechat/utils/ui.js`：`routes` 列表增加 `'follows'`（使登录后可返回我的关注）。
- `pages/account` 入口（集成人）：建议文案“我的关注”，副标题“关注的公开赛事；微信提醒未启用”。
- `packages/contracts/runtime-privileges.json` 新表：
  ```json
  "event_follows": { "privileges": ["SELECT", "INSERT"], "updateColumns": ["status", "cancelled_at"] }
  ```
  （无 DELETE；测试中的“迁移不写数据”断言已在本模块测试里，运行时清单断言待集成人加入。）
- 表数/迁移数计数（readiness、c02-upgrade、p07、backup/restore 等）：+1 表 `event_follows`、+1 迁移 021。
- `apps/wechat/utils/api.js` 白名单已含全部关注路由，无需改；`request-body.ts` 无需新上限。
- `pages/planned` “关注与消息”文案未改：其内容仍描述未来消息中心，与本轮事实不矛盾。

## 5. 执行的命令与结果

| 命令                                                                                                             | 结果                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                              | 通过                                                                                        |
| `cd apps/api && npx vitest run src/event-follow-domain.test.ts`                                                  | 8/8 通过                                                                                    |
| `cd apps/api && npx vitest run src`                                                                              | 544/548，失败 4 项均为既有 `account-maintenance.test.ts`（Windows POSIX 模式/符号链接基线） |
| `TEST_DATABASE_URL=… npx vitest run test/c19-event-follows.integration.test.ts`                                  | 10/10 通过（真实 PostgreSQL 18）                                                            |
| `TEST_DATABASE_URL=… npx vitest run test/c18-directory.integration.test.ts test/p05b-public.integration.test.ts` | 19/19 通过                                                                                  |
| `node --test apps/wechat/test/c19-follows.test.cjs`                                                              | 25/25 通过                                                                                  |
| `node --test apps/wechat/test/*.test.cjs`                                                                        | 554/559；失败 5 项 = 既有 Windows 基线 4 项 + 上述待注册路由 1 项                           |
| `npm run build --workspace @small-city-basketball/api`                                                           | 通过                                                                                        |
| `TEST_DATABASE_URL=… node --test --test-concurrency=1 tests/wechat-api/c19-follows.test.mjs`                     | 1/1 通过                                                                                    |
| `TEST_DATABASE_URL=… node --test --test-concurrency=1 tests/wechat-api/event-platform.test.mjs`                  | 1/1 通过（赛事页改动后既有主线回归）                                                        |
| `npx prettier --check --end-of-line auto <本模块文件>`、`git diff --check`                                       | 通过                                                                                        |

真实 PG 覆盖：未登录 401、输入 422、首次 201/重复 200、并发重复只一行一审计、审计 org_id 为空；未知/撤销/机构停用拒绝体一致且不写；UNLIST 后仍 ACTIVE；撤销→INVALID 且 `event=null`、列表不含原名称；重开新键不继承、旧键关注 404；撤销后取消成功且幂等；取消后再关注产生新行；他人不能读/查/取消（与不存在同 404）；退出会话后 401；键集分页含同时间戳且中途取消不跳行；关注与撤销并发不留下可读关注；关注与取消的审计失败均回滚；DELETE/TRUNCATE/复活被拒；向已撤销发布插入被触发器拒绝；限流 429 不写；迁移顶层无数据语句、无 SECURITY DEFINER。

真实 API 页面闭环：未登录观众打开分享链接（无 Cookie、无私有请求、提示登录）→ 球迷注册登录后在赛事页关注（数据库 ACTIVE）→ 我的关注列出 → 主办方撤销公开观赛 → 我的关注显示“已失效”且页面数据不含原赛事名 → 旧链接赛事页不可用并只给“查看我的关注” → 在我的关注取消（数据库 CANCELLED）→ 重开新键页面显示未关注并可再次关注 → 同一设备切换到另一账号，列表与关注区块清空，新账号只读自己的数据、无任何关注写请求，原账号行不受影响。（公开赛事准备、撤销/重开由 HTTP 夹具完成，属主办方 Web 步骤。）

## 6. 未执行

- 微信开发者工具（weapp MCP）与真机未运行；VM 测试不是微信运行时。
- 未推送、未建 PR、未跑 CI；正式环境 Migration 未执行。
- 订阅消息发送、模板、用户许可：未实施（见通知草案）。
- 集成后表数/权限清单/计数测试需集成人在总分支重跑。

## 7. 审查风险

- **权限**：所有路由只按会话 actor 的 `user_id` 过滤；follow ID 不可用于读取他人数据。运行时角色须只授予 `SELECT, INSERT` 与 `UPDATE(status, cancelled_at)`。
- **数据库**：INVALID 为派生值，依赖 `public_event_publications.revoked_at` 单向不可逆（005 触发器保证）。读取联表 4 张表，有 `(user_id, created_at DESC, id DESC) WHERE ACTIVE` 索引；单用户关注数量大时仍为键集分页。
- **并发**：关注事务锁序 身份 → 机构 → 赛事 → 发布（FOR SHARE）→ 关注行；撤销需要发布行 FOR UPDATE，因此与关注互斥，测试验证两种先后顺序都一致。取消只锁身份与关注行。
- **恢复**：关注/取消均幂等，结果未知时页面提示刷新核对，重复操作不会产生第二条或报错；赛事页客户端在会话修订变化时丢弃迟到响应。
- 机构停用后恢复会让关注重新 ACTIVE（见 §3-6），需审查确认是否接受。
