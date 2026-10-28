# C19 交接：F 既有功能真实验证 + G 旧库升级/恢复演练（Agent 验证）

2026-10-28 Asia/Shanghai；负责人 Agent 验证；worktree `D:\Projects\scb-c19-verify`，分支 `c19/verify`，基线 `2eac213`。仅本地提交，未 push / PR / 部署 / pack / 生产操作。未修改任何产品代码与共享文件。

## 提交

| SHA | 内容 |
|---|---|
| `c7dbca0` | 小程序测试辅助：预览资源路径在 Windows 上统一为 `/`（修复 3 项既有 Windows 失败，断言未改动） |
| `1b796eb` + `a151896` | G：`apps/api/test/c19-upgrade.integration.test.ts`、`fixtures/c19-upgrade/{generate-legacy-007.mjs,legacy-007.json}` |
| `fea1e5a` | F：受信外链 `c19-verify-media-links.test.mjs`；`support.mjs` 追加 `startServerWith` 与 HTTP 夹具函数 |
| `430084a` | F：我的赛事 `c19-verify-my-events.test.mjs` |
| `c2fb0d4` | F：球队成员 + 报名私有文件 `c19-verify-team-entry.test.mjs` |
| `2a74ba7` | F：C07 授权 `c19-verify-performance.test.mjs` |
| `a104882` | F：四类预约 `c19-verify-bookings.test.mjs` |

## F：真实页面代码 → 真实 API → 隔离 PostgreSQL

所有用例在 VM 中运行实际 `Page`/utils 代码，`wx.request` 转发到 loopback 真实 API，数据库为每个文件自建并删除的 `scb_test_*` 子库。HTTP 只用于准备数据（球队、冻结赛事、FINAL 比赛、公开观赛），验收动作全部经页面方法触发，并断言实际请求体与数据库行。

| 要求 | 测试 | 驱动页面 | 结果 |
|---|---|---|---|
| MULTI / TOURNAMENT / SEASON / TIME_BLOCK 四类预约 | `c19-verify-bookings` › MULTI / TOURNAMENT / SEASON / TIME_BLOCK orders… | booking-create、player-center、platform（夹具） | 通过 |
| 条件意向激活 | 同上（TOURNAMENT 决赛 CONDITIONAL → ACTIVATE → 球员 ACCEPT） | booking-detail | 通过 |
| 变更、取消、争议及原编号恢复 | 同上（提议变更同意/拒绝、逐项取消、争议丢响应后 `recover()` 原样重发且审计仅 1 条、当事人不能处理、独立运营 RESUME；SEASON 创建丢响应同编号恢复） | booking-detail、booking-create | 通过 |
| C07 提名、本人同意、拒绝/撤销及撤销后数据消失 | `c19-verify-performance` › C07: nomination, own consent… | performance（主办方/本人）、player（观众）、player-center、platform | 通过 |
| 球队成员维护与冻结名单不变 | `c19-verify-team-entry` › team page maintains long-term members… | team、entry | 通过 |
| 报名私有文件上传、读取、撤销、权限隔离 | `c19-verify-team-entry` › entry page: private file upload… | entry | 通过 |
| “我的赛事”多页、500 届截断和后续页失败 | `c19-verify-my-events` › my events: 10 pages… | watch、account | 通过 |
| 受信外链创建、发布、撤销和非法链接拒绝 | `c19-verify-media-links` › trusted external link… | match-media、match（匿名观众） | 通过 |

要点：
- 受信外链：隔离服务通过 `startServerWith({ media: { trustedExternalHosts: ['media.example.com'] } })` 注入合成受信主机，无生产配置、无视频供应商。8 种非法链接（http、非受信主机、端口、userinfo、`#`、IP、localhost、`javascript:`）页面拒绝且零请求；同一会话直接请求服务端逐一 422 且无行。合法链接草稿 → 发布（匿名 match 页可见）→ 撤销（不可见、不可再发布）。**微信内实际播放未验证，另列。**
- 我的赛事：甲机构 501 届读满 10 页（每页游标）并提示截断，乙机构第 2 页响应丢失时保留已读 50 届并提示“后续赛事读取未完成”；刷新后乙完整 60 届；乙撤销成员权限后不再显示乙的任何行；切换账号立即清空。
- 球队成员：改名/移除/新增一次保存；保留成员 id 不变、仅移除者 ARCHIVED、新成员无客户端 id；冻结名单 `entry_roster_players` 与 `registration_freezes` 逐行不变，报名 API 仍返回冻结时姓名；过期副本保存被版本拒绝；无授权者不可读。（“保存时先全部归档再恢复”的实现细节属 Agent 球队修复项，本测试只断言净结果。）
- 私有文件：PNG 上传（行内字节、类型、用途核对）、预览后隐藏即删临时文件；匿名 401、另一球队领队 404、主办方可读；撤销后所有人 404/410，页面不再打开；切换账号清空列表。
- C07：提名丢响应后同 commandId 重发只生成 1 条；PENDING 不公开；本人同意后公开 5 分；本人撤销、本人拒绝新提名、主办方撤销后公开统计均为 `sourceCount 0 / totalPoints null / recentRecords []`，球员页显示 0 来源无记录；非赛事管理者无可管理赛事、来源接口 403/404。

## G：旧库（001—007）持久化升级与恢复演练

方法（满足“不能用单个用户或内存重放代替”）：
1. 历史代码：`git worktree add --detach` 到 scratchpad `hist-007`，检出 `1534216`（最后一个迁移集合恰为 001—007 的提交，`af53aa0` 才新增 008；001—007 文件至今无差异）。复用当前 node_modules（junction，依赖版本一致），`contracts` 指向历史版本，`tsc` 构建。已删除 junction 与该 worktree。
2. `generate-legacy-007.mjs` 用**历史 API 的 HTTP 接口**在自建隔离库中完成：报名注册、2 队报名审核冻结、排赛发布、计分规则、排名规则发布、10 条计分命令（含收据、一次 VOID_STAT）、独立确认 FINAL、公开观赛、overlay 授权并引导会话、一条未接受邀请、一个已登出会话；然后导出 40 张表全部行（`to_jsonb`、按 C 排序）及每表哈希，生成 `legacy-007.json`（合成数据、仅在一次性库有效的凭据）。
3. `c19-upgrade.integration.test.ts`（6 项，均通过）：
   - 用未改动的 001—007 SQL 重建历史 schema（校验和逐一等于历史 `schema_migrations`），装载全部行，逐表哈希与生成时一致（精确复现），并逐个外键检查无孤儿。
   - 当前 `migrate()` 应用的迁移 = 目录中 001—007 之后的全部文件（动态读取，019—022 合入后自动覆盖）；除 `schema_migrations` 外所有旧表在旧列上哈希不变（命令编号、收据、事件、确认、赛程、公开身份、overlay、会话、邀请、密码哈希）。
   - 新表：只有 `booking_settings`（016 单例费率配置）与 `event_commercial_activations`（013 对已发布旧赛事的 `LEGACY` 存量放行，逐字段断言）有行；`event_directory_listings` 及 C19 冻结契约中的表须为 0 行，**当前候选尚无 019—022 时这些表被跳过并记录（不判失败）**。新列在旧行上仅为中性默认（publication LIVE、TEAM_ONLY、player_stats/group_config/login_name 为 NULL）；无 NOT VALID 约束。
   - 校验和：二次运行为空且全库指纹不变；在一次性副本中篡改 004 校验和并删除最后一条迁移记录，`migrate()` 报 `Migration checksum mismatch: 004_p05_scoring.sql` 且整体回滚（被删迁移未重放）。
   - 当前 API：未过期旧会话可用、已登出会话 401；10 条旧命令收据经 `GET …/commands/:id` 与历史响应一致；原 CONFIRM_RESULT 信封重放返回原收据且事件数不变；确认 1 条；公开赛事/赛程/排名/比赛与历史公开响应一致（忽略 serverTime）；公开目录为空；overlay 会话可读快照。以上只读后旧业务行哈希不变。
   - 备份→恢复→隔离清理：升级后先新增一项授权（C18 目录 LIST），恢复副本指纹与源库全表一致；运行 `ops/recovery/quarantine.mjs` 的真实 `quarantineRestoredDatabase`；之后所有旧会话与新会话 401、公开编号 404、overlay 拒绝、目录为空、未接受邀请不可接受、机构停用（重新登录也 403/404）。

## 执行的命令与结果

- `node --test apps/wechat/test/*.test.cjs tests/wechat-tools/devtools-ui.test.mjs`：修复前 550/546（4 失败），修复后 550/549，剩余 1 项为 symlink EPERM。
- `TEST_DATABASE_URL=… node --test --test-concurrency=1 "tests/wechat-api/*.test.mjs"`（含既有 3 个文件）：10/10 通过（既有 booking-flow 约 213 s，新增 7 项共约 52 s）。
- `TEST_DATABASE_URL=… npx vitest run test/c19-upgrade.integration.test.ts test/c02-upgrade.integration.test.ts test/c18-directory.integration.test.ts`：3 文件 21/21 通过。
- `npm run build --workspace @small-city-basketball/api`、`npm run typecheck`：通过。
- `npx prettier --check --end-of-line auto tests/wechat-api apps/api/test apps/wechat/test/helpers/native-preview.cjs`、`git diff --check 2eac213 HEAD`：通过。
- 生成夹具：`TEST_DATABASE_URL=… HIST_API_DIST=<hist-007>/apps/api/dist node apps/api/test/fixtures/c19-upgrade/generate-legacy-007.mjs` → 40 表 / 10 命令 / 142 行。

## 未执行 / 平台前提

- **pg_dump / pg_restore 18 不可用**：任务给出的便携目录只有 `initdb/pg_ctl/postgres`；本机另有 pg_dump 16 属其他项目，既不兼容 PG18 也不得混用，未使用。因此恢复以 `CREATE DATABASE … TEMPLATE`（服务端复制）代替归档往返；测试在找到 PG18 的 `pg_dump/pg_restore`（`SCB_PG_BIN` 或 PATH）时自动改走真实 `--format=custom` 往返。`ops/recovery/backup.mjs`、`restore.mjs` 本身未运行（需要 `scb_backup/scb_admin/scb_migrator` 角色、表数 66 与迁移数 18 的硬编码），留待 Linux CI。
- 本隔离集群没有 `scb_migrator` 角色，未创建集群级角色（避免影响共用集群上的其他 Agent）；quarantine 的 `SET LOCAL ROLE scb_migrator` 一句被跳过，其余 SQL 为真实实现。存在该角色时测试直接使用真实连接。
- 装载旧数据需要 `session_replication_role = replica`（旧外键存在环），即测试数据库用户需为超级用户（CI 的 postgres 服务通常满足）；装载后逐个外键复核。
- 夹具会话为 30 天、overlay 为 7 天有效（自 2026-10-28 起）；过期后测试改为断言 401 并记录，不判失败。
- 微信开发者工具、真机、微信内外链播放均未执行。
- `native-components.test.cjs` symlink 用例：Windows 需开发者模式或 `SeCreateSymbolicLinkPrivilege` 才能创建符号链接，这是真实平台前提，未改动。

## 发现与审查风险

- 未发现产品缺陷（所有新测试在未改产品代码的情况下通过）。
- **quarantine 覆盖面**：`ops/recovery/quarantine.mjs` 只处理会话、运营、微信身份、邀请、公开发布、overlay、租约与机构；不处理 `event_directory_listings` 行（目前靠机构停用与公开发布撤销间接隐藏，演练已验证目录为空），也不知道 019—022 的新授权表（`season_data_grants`、`team_join_codes`、`team_member_bindings`、`event_follows`、上传会话等）。这些模块合入后，建议集成人决定 quarantine 是否需要撤销/置空这些授权，并在本演练中补一项“新增 C19 授权恢复后不复活”的断言（当前只断言升级后为 0 行）。
- `ops/recovery/fingerprint.mjs` 硬编码迁移数 18、backup/restore 硬编码 66 表——集成新增迁移时需同步（集成人职责）。
- 013 的 `LEGACY` 商业激活是对已发布旧赛事的存量放行，不授予数据访问；已在演练中逐字段固定。

## 共享文件变更请求

无。

## Codex 接续验证（2026-10-28 Asia/Shanghai，进行中）

- 接续目录 `/workspace/scratch/608836f8d204/scb-c19-validation`，分支 `codex/c19-validation`；开工基线 `72a51bd`，已同步集成人合入媒体/赛季的 `ace5f47`。此前 Windows 报告保留为历史，本节单列当前 Linux 实测。
- 发现真实外链联调仍只统计旧 `POST /media`；改为检查新 `POST /media-requests`，非法输入直接检验新后端入口并验证页面未退回旧写入路径。
- “我的赛事”截断补充精确 ID 集合断言，确保显示的是服务端排序的前 500 届，不只核对数量。
- 旧库演练要求完整 C19 候选表必须存在；移除已在球队模块说明中取消的 `team_operations`。全库指纹现在包含 `media_files.payload`，不再遗漏文件字节。
- 恢复前通过真实 HTTP 创建申请入口、加入码、待认领、两个有效绑定、PENDING/ACTIVE 私有赛季授权、赛季归属、关注、已完成图片和未完成分片上传；恢复后检查撤销与负载清理，并在自有副本重新启用机构，验证旧凭据及授权仍不能复活，已完成文件和成员历史保持。
- `SCB_REQUIRE_ARCHIVE_RESTORE=1` 要求 PostgreSQL 18 的真实归档往返及实际 `scb_migrator` 角色；仅在新建且拥有回执的恢复测试库授予该角色隔离清理所需 DML。归档目录支持 `SCB_PG_WORK_DIRECTORY` / `RUNNER_TEMP`。未设置严格模式的本地替代路径仍明确记录，不冒充归档验收。
- 当前已通过类型检查及 API 构建；隔离 PG 和最终清理实现由集成人准备，真实 API/升级演练待运行。未修改产品代码、共享文件、AGENTS.md 或生产环境。
- 跨平台复核补充：历史导出的 `timestamptz` 序列化为 `+08:00`，Linux 默认 UTC 会造成同一时刻哈希不相等。夹具与生成器记录 `databaseTimeZone`，只对本演练新建的自有数据库固定该导出时区；所有旧行和原始期望哈希原样保留，不重算期望值掩盖差异。
- 增加 P07 最小运行身份端到端检查：实际 `scb_runtime` 连接驱动申请审批、普通成员加入、分片接收/完成/取消、媒体回执、赛季归属/独立同意/离队失效、关注/目录发布/撤销公开/取消关注；复用原报名冻结与正式发布 HTTP 夹具，最终核对严格 readiness 且仍禁止读审计表。只初始化首个 owner 使用迁移身份，业务动作不借超级用户绕过最小列权限。
- 当前环境无可运行的本地 PostgreSQL / Docker，真实 PG 检查明确留待本候选 CI（含严格归档与 P07 runtime）；没有把类型检查记为数据库检查通过。`npm run typecheck`（当前修改）、API 构建及 `git diff --check` 已通过。
