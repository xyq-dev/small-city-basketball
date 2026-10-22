# P05-A 独立 PostgreSQL 测试记录

## 当前上下文

- 更新：2026-10-22T03:51:23-04:00。
- 负责人：`/root/p01_browser_tests`；集成人 `/root`。
- 目录：`/workspace/scratch/93747c9ad2cb/p05-tests`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 分支：`test/P05-scoring`；开工 HEAD `fd25051141185e0843e129e5c9ccc6ae8d5ad440`，开工工作区 clean。
- 状态：测试源码完成 / LOCAL_ONLY，等待 root 整合及真实 PG CI。已读取 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION 及完整 P05-A 合同。
- 唯一写入：`apps/api/test/p05-*.ts` 和本记录。原 P02/P03/P04 的 68 条真实 PG 场景及 support 不修改。
- 用户项目授权及 root 任务授权允许开发、静态检查、指定路径提交；本分工不 push、不改实现/契约/迁移，不操作生产数据库。

## 已完成与当前依赖

已核验 checkout 和业务合同，完成夹具及真实锁竞争设计。精确 DTO `592a2e5df252ab0bb333aeca99ef93777afe49de` 已经 root 授权 cherry-pick，本 worktree 为 `e7da4e4`；root 独立整合为 `9f3dc4c`。后续测试提交不重复携带契约改动。

复用 P04 的隔离数据库保护、生产 scrypt 合成身份和真实 HTTP 登录；报名、freeze、正式发布仍通过 HTTP 生成。默认三个身份复用：OWNER 管理及独立确认，第二机构 OWNER 在本机构作为有效成员且仅获本场 SCORER，第三身份管理球队报名。每场/赛事独立业务状态与日期，不消耗额外注册限流、不降低哈希成本、不清库。

原子事务和权限边界由真实 PostgreSQL 与 HTTP 响应验证；不以内存数据库、模拟返回值或测试生产开关代替。

## 已实现覆盖

| 领域 | 计划证明 |
|---|---|
| 控制租约 | 双端/双 tab 互斥、同绑定 acquire、fence 递增、过期 renew/release 不复活或误释放、heartbeat 不改 matchVersion、过期不自动暂停时钟 |
| 幂等与收据 | 同 ID 同 hash 并发仅一次事件/审计，异 hash 409，返回原 appliedVersion 和当前 snapshot；receipt 读等待在途写；当前撤权先于 receipt/replay |
| 规则与首次转换 | 显式规则白名单/范围、首次 READY 永久锁定；两场 PREPARE/START 以真实锁等待证明无 Event SHARE 升级死锁 |
| 最小授权 | 无 EventStaff 的本场 SCORER 可操作本场、其他场及赛事资料隐藏；OWNER 不自动主写；旧 cookie 撤权立即生效 |
| 时钟与状态 | DB 时间锚、客户端 capturedAt 非排序权威、暂停/设钟/节次/加时/结束守卫；小节长或受控 anchor 调整验证归零不自动 pause/FINAL |
| 更正和历史 | append-only 补录/撤销/替换、合法分值/当节计数、跨场目标及重复撤销拒绝、原 kind/period 保留，待确认禁止普通写分和时钟 |
| 独立确认 | 历史实际写者及当前任一球队领队不能确认，OWNER 无例外；撤销统计/撤权不洗历史，旧 version 确认拒绝 |
| 确认竞争 | 激活 grant 先持 Team UPDATE、等待外部 grant 行锁；确认等待 Team，释放后必须因新领队身份拒绝，无确认记录 |
| 正式结果 | FINAL 仅有理由重开到 PENDING_CONFIRMATION，旧结果不可变，重确认新增记录，不恢复 LIVE |
| 原子性与兼容 | 审计失败导致 projection/events/receipt/status/confirmation 全回滚；P04 match 读取真实新状态，freeze/source/hash/计划事实不变 |

## 并行与锁测试约定

原 child `/root/p01_browser_tests/p04_test_review` 复用为控制/幂等子任务，唯一文件 `apps/api/test/p05-control.integration.test.ts`。PG 负责人维护 `p05-scoring.integration.test.ts` 和 `p05-support.ts`；不重叠写入。

所有并发请求实际启动，使用 `pg_stat_activity` 和 `pg_blocking_pids()` 观察等待链，不用固定长 sleep。外部事务只暂停合同锁序中的真实行；清理先 rollback/释放外锁，再 `allSettled` 等待请求。租约过期可在独立合成场次受控回拨 SQL 时间，保留实际 schema CHECK；不等待 30 秒或引入生产测试钩子。

## 验证证据

| 检查 | 实际情况 |
|---|---|
| 仓库/分支/HEAD/clean/合同读取 | 已执行，见上述上下文 |
| P05 格式/严格类型 | 2026-10-22T03:34:52-04:00，三个 P05 测试文件的 Prettier、TS7 NodeNext strict/noUncheckedIndexedAccess/noEmit、git diff --check 均通过；未做运行时通过声明 |
| P05 真实 HTTP + PG | 本地未执行；root 回报 CI39742003544 的 87 条真实 PG 已全部通过，包含原 19 条 P05；本次新增第 20 条仍待 CI |
| Migration 004 | API 负责人独占；本分工未编写或执行 |
| PG 重启、浏览器与远端 CI | root 回报上述首轮 CI 的真实 PG 重启通过，原 8 条 API 浏览器通过；本分工未独立运行这些检查 |

## 2026-10-22T03:31:14-04:00 检查点

- 主测试已经落盘 10 条：最小场次授权、P04 计划事实兼容、统计及修正历史、规则锁/双版本、DB 时钟与节次/加时、跨场目标/重复撤销、OWNER 历史参与不可确认、Team grant 激活与确认锁竞争、精确版本确认/重开历史、SQL 不可变及投影/租户约束。
- 共享 helper 采用精确 DTO，`PREPARE_MATCH`/`START_MATCH` 每次重读 Event 版本；独立 DELETE helper 不改旧 support。
- 控制子文件已写 HTTP 租约和命令重放部分，继续补真实 SQL 过期、收据等待、审计回滚及双场 PREPARE/START 屏障。
- 已只读审核 004 真实表/约束，未执行 Migration。API 负责人已确认结果 `sourceMatchVersion`/`lastEventSeq` 绑定确认前 snapshot，测试保持该语义；源码初稿差异已反馈其负责人。
- 当前没有 P05 通过或 MAIN 整合结论。下一步结合完整 service/controller 复核接口，完成子任务静态检查，提交指定测试与本记录后由 root 运行真实 PG CI。

## 2026-10-22T03:36:26-04:00 最终交付

- 完成 19 条新 PG 场景：主文件 10 条、控制文件 9 条。原 68 条场景及 support 未修改；整合后预期 87 条独立 PG 场景，实际执行数量与结果由 CI 给出。
- 控制文件已完成租约绑定和 fence、受控 SQL 过期、同 ID 同/异 hash 并发、在途收据读取等待、撤权顺序、审计失败全回滚后同命令重试，以及双场 PREPARE/START 真锁屏障。
- 原 child 已完成其唯一文件并交还写入权；未单独提交，也未启动数据库。测试账户使用真实生产哈希成本，未修改限流或守卫。
- API 最新确认采用确认前的 `sourceMatchVersion`/`lastEventSeq`；严格断言保留。root 已提供源码整合完成信息，本分工不重复 cherry-pick 业务实现。
- 本次只提交 `apps/api/test/p05-support.ts`、`p05-scoring.integration.test.ts`、`p05-control.integration.test.ts` 与本记录。工作区 node_modules 是本地依赖符号链接，不纳入提交。
- 本地没有可安全启动的 PostgreSQL，因此未执行 P05 真实 HTTP/PG、重启或浏览器测试；未声称这些验证通过。下一步由 root 进行 PostgreSQL 18.6 完整 CI，若出现真实失败再独立修复提交。

## 2026-10-22T03:51:23-04:00 自动审查回归补充

- root 回报首轮 CI39742003544：87 条真实 PostgreSQL 场景及真实数据库重启全部成功。本地没有运行 PG，不将该结果冒写为本地执行。
- 按自动审查 finding 补 1 条独立场景，原 19 条不改。先停用机构成员，再以大写 UUID 路径停用本场既有 SCORER；无需临时恢复成员。验证旧 CAS 拒绝、match/source 版本一致加一、审计仅加一、原 lease 身份/fence 不变且期限立即失效。恢复机构成员后，原控制凭据仍不能续约或新增命令。
- 同场验证停用 membership/user 时不能 ACTIVE，以及未知 UUID、仅机构成员但未获本场分配、无机构成员资格、跨机构不能凭空创建 DISABLED。拒绝前后比较整个场次 scoring fingerprint，证明没有 staff/lease/版本/投影/事件/收据/审计副作用。
- 新场景在 finally 恢复合成账号及共享 membership，旧 68 条及原 P05 19 条保持原样。整合后预期 88 条独立 PG（旧 68 + P05 20），新场景真实执行待 root 后续 CI。
- 本次 delta 的 Prettier、三个 P05 文件的严格 NodeNext TypeScript/noUncheckedIndexedAccess/noEmit、git diff --check 均通过。只改 `p05-control.integration.test.ts` 与本记录；不改 API/DTO/迁移，不 push。
