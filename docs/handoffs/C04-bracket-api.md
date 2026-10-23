# C04 调度与逐轮发布 API 交接

2026-10-23（Asia/Shanghai）；负责人 c04_bracket_design；接收 root。REVIEW / LOCAL_ONLY。

## 实际上下文与权限

- worktree `/workspace/scratch/dc6a786e1a31/c04-bracket-api`，origin `https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/C04-bracket-api`，基线/当前 HEAD `4b489973ce3937f860d4053130e8abe6e598c275`，未 commit/push。
- 开工仅有三个 node_modules 依赖 symlink（未跟踪）。为联编添加临时 `apps/api/src/knockout-domain.ts` symlink，指向 domain 作者 worktree；该项不是本作者代码，不应由本任务整合。旧工作树与修改未动。
- 只写获分配的 scheduling-service、新 knockout-service/controller、011 和本交接。app.ts、contracts、纯 domain、ACL/recovery、集成测试、共享状态由 root/其他作者拥有。
- 沿本轮 Git/PR/隔离 CI/审查后合并授权；本作者只本地修改和验证，没有执行生产部署、数据库、账号维护、付费或外部凭据/公网端口操作。

## 完成与冻结文件

- `apps/api/src/scheduling-service.ts`：共享调度 helper 改 protected；严格 format 与 algorithm 对应；原 RR 路径保持，新增 SE 首轮生成/重新抽签/分配/校验/初始发布。rounds 用规范 tuple 比较，避免 JSONB 属性顺序影响来源校验。正式 SE 子赛改期必须不早于原确认父赛结束；原比赛状态/START_MATCH 守卫继续阻止 FINAL 父赛或祖先改期。
- `apps/api/src/knockout-service.ts`：GET 私有签位；POST 严格完整轮分配和 4–500 Unicode 字符 reason，event CAS 与 next-round sourceHash 双校验。组织 mutex→event UPDATE 串行化；原当前 matches/有效确认及 immutable round proofs 交纯 domain 投影，沿用原场地/球队预约和权限。已有同届赛程加新轮一起验证冲突/休息，外部预约排除本 publication。显式验证子赛时间有向依赖；完整新增本轮 fixture/match/预约后原子撤销旧 LIVE 并 event version+1/audit，无自动新公钥，无第二套比赛状态。
- `apps/api/src/knockout-controller.ts`：导出 `KnockoutController`、`SCB_KNOCKOUT_SERVICE`，GET `events/:eventId/knockout` 和 POST `knockout-round-commands`，由 root 在原 app 注册。
- `apps/api/migrations/011_c04_knockout.sql`：旧 001–010 没有修改。单新增 `knockout_round_publications`；sources 为原确认五字段；fixtures 为不可变发布计划凭证，非比赛状态。首轮完整发布数量按算法分派；后轮仅同 transaction_id 精确凭证可追加，commit guard 强制整轮 fixtures/matches/一场地两球队预约和 event version 同事务。严格核当前 FINAL/确认/winner 与固定 seed 括号（首轮 genuine bye 可无确认）。原已发表参赛身份不可变、受控改期、预约排除约束保持。public.ruleset_id 仅 SE 可 NULL；公开当前全部比赛精确映射，原创建事务与 immutable public keys 防线保持。
- 011 SHA256：`23027d473167ae319b826b3bc2167baea7d59e548f7e75b58294db5ddbcccce3`。

## 验证证据

| 实际检查                                                   | 环境与结果                                                |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `npm run typecheck --workspace @small-city-basketball/api` | 本机 worktree，使用 domain 作者临时依赖联编；通过         |
| `npm test --workspace @small-city-basketball/api`          | 23 文件、313 既有源码测试通过；不是 C04 PG 集成验收       |
| `npm run build --workspace @small-city-basketball/api`     | 本机通过；末次时窗查询/错误详情调整后 strict/build 再通过 |
| `npx prettier --write` 三个获分配 TS 文件                  | 已格式化                                                  |
| 011 Migration 执行 / 真实 PG / 浏览器 / 容器 / CI          | 本作者未执行，PG 与 root 在隔离 CI 接续；不能标记通过     |

服务错误：`VERSION_CONFLICT`、`INVALID_EVENT_STATE`、`KNOCKOUT_ROUND_NOT_READY`、`KNOCKOUT_SOURCE_CONFLICT`、`KNOCKOUT_DEPENDENCY_ORDER`、`SCHEDULE_CONFLICT`（409）；结构非法 422。禁止跨机构读写沿原 404/403/401。

## 遗留与下一条操作

root 精确复制上述四个代码/迁移文件，保留自己的 domain/contracts/app/ACL/recovery；整合后跑完整 strict/source、C04 PG 与所有旧 RR PG、原真实浏览器/恢复流程。SQL 本机只静态审查，实际 PG 解析、guard 与隔离运行必须作为门禁。独立审查需重点看 proof source/current confirmation、JSON/NULL、事务顺序、首轮 bye 坐标与全轮原子性。生产仍未部署或执行迁移；无原生 OBS/真机证据。

## 独立审查 P1 delta

root指出 FINAL 后合法工作人员安全维护会增加 match/state version。011 已取消 source.matchVersion 必须等于 current match.version 的旧假设，改为必须精确等于 current confirmation.source_match_version+1（确认生效固定版本），且不得大于 current match.version。current FINAL、current confirmation ID、state.source_version=current match.version、无重确认/停钟、比分/last_event_seq 和 winner 身份防线全部保留。仅此 SQL delta，diff 检查通过；新 hash 如上，真实 PG 回归仍待 CI。
