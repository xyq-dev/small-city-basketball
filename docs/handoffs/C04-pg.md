# C04 真实 PostgreSQL 测试交接

2026-10-23（Asia/Shanghai）；c04_pg；REVIEW / LOCAL_ONLY。独立目录 `/workspace/scratch/dc6a786e1a31/c04-pg`，分支 `feat/C04-pg`，基线 `4b489973ce3937f860d4053130e8abe6e598c275`，origin 原项目。开工只存在父代理预置的三个未跟踪 node_modules 依赖链接，保留；未覆盖其他修改、未 commit、未生产操作。

## 已编写

仅新增 `apps/api/test/c04-support.ts`、`apps/api/test/c04-knockout.integration.test.ts` 与本交接。复用原 p04/p05/p05b/p06 实际 API、数据库与身份 harness，不 mock 比赛或更改注册限流。单个五队 harness 只创建三个合成用户，凭据种入隔离测试库后仍走真实 HTTP 登录。

15 项集成用例覆盖：3/5队首轮真实比赛与轮空不造状态、n−1 球员榜分母；未确认/待独立确认不能晋级/完赛；强制加时与连续两次加时；5队4真实比赛→逐轮显式发布→实际逐人计分/确认→最终共同名次→完赛/历史/归档/重开；首轮 FINAL 人员撤权后晋级、下游发布后人员维护、闭赛安全撤权不污染有效确认及hash；新轮撤销旧公开键、显式fresh/HISTORY、公开DTO白名单及OBS独立授权；来源更正、旧hash、已消费来源禁止重开及旧成功commandId重放；版本/并发重复发布恰好一次；有向时间/休息/严格完整分配及原子无变化；后轮普通受控改期不能绕过来源结束下界且源FINAL不可改期；损坏当前确认fail closed；跨机构、匿名、参与者、match-only、event scorer无晋级写权；审计故意失败全事务回滚（含公开撤权）；只有proof而无同事务比赛/预约的COMMIT失败；proof不可变及合成最小只读/插入角色无UPDATE/DELETE；发布阻塞event及真实源重开已持event SHARE时发布等待并拒绝的竞态。

人员维护后proof.matchVersion按有效确认的 sourceMatchVersion+1，不能按会随人员维护递增的当前match.version。该回归加在五队主链，避免增加昂贵身份/完整链夹具。

## 已执行与未执行

- 本worktree `./node_modules/.bin/prettier --write apps/api/test/c04-support.ts apps/api/test/c04-knockout.integration.test.ts` 成功。
- 本worktree `./node_modules/.bin/tsc --noEmit -p apps/api/tsconfig.json` 成功；这是既有源码+新增测试与共享合同联编，不是新服务实现已完成或PG已通过。
- 本机无可用PG/Docker，未执行这些集成用例。父代理整合后须在现有真实隔离CI执行、核对实际失败与全量日志；这里不宣称真实PG通过。
- 最小角色用例只建本轮唯一NOLOGIN合成角色，GRANT本库proof SELECT/INSERT后以SET LOCAL ROLE核验写拒绝，finally DROP OWNED/DROP ROLE；这不是实际生产runtime角色证据。既有P07隔离生产角色验收仍需由父代理同步新manifest后运行。
- 未补旧001–007已持久化FINAL赛事升级缺口；此项仍须在交接中保留，不把新schema夹具当旧库升级。

## 下一步

父代理复制明确三个文件到集成树，联编新增服务/011与纯domain，CI真实PG后按实际证据更新状态。需要重点核对新proof延迟commit guard的直接SQL夹具与服务JSON命名保持一致；两处并发测试使用原APPLICATION_NAME/blockedPid及withRowsLocked进行真实行锁同步，不以sleep猜时序。
