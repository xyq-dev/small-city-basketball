# C06 独立验证交接

2026-10-24（Asia/Shanghai）；负责人 booking_tests；REVIEW / BRANCH_ONLY（测试已编写，真实PG执行受阻）。

## 现场与边界

- 工作目录 `/workspace/scratch/608836f8d204/booking-tests`，分支 `feat/player-reservations-tests`，基线 `2577443f62d3e47a7ff6189c0ceee00af838bae7`。
- origin 为原 `xyq-dev/small-city-basketball`；开工工作区干净。已读AGENTS、当前状态、看板、COLLABORATION与root C06任务卡。
- 仅拥有新增预约集成测试与本交接；不更改业务实现、共享契约或生产配置。所有身份为合成测试资料。
- 本机未找到postgres/pg_ctl/initdb/psql/Docker；旧runtime缓存只有包元数据。未接入或操作旧库/服务，不能宣称本地真实PG通过。

## 验证计划

复用既有 `testDatabaseUrl` 的 `scb_test_*` fail-closed检查、真实HTTP登录、Origin和事务迁移；新增文件由现有隔离CI自动纳入 `npm run test:integration`。

覆盖：会话/Origin；本人档案与独立审核；跨机构私单；服务端整数分/10%及历史费率快照；条件场不占档；接单并发/冲突及事务回滚；CAS与幂等；撤权后成功请求重放仍拒绝；未开通支付不能伪造付款或结算；逐场取消、变更双方确认与争议冻结。具体断言以确认契约与实现为准，发现需求缺口反馈root，不能削弱测试冒充完成。

## 已编写

新增 `apps/api/test/player-booking.integration.test.ts`，24项真实PG/HTTP用例。复用原真实HTTP身份与报名/冻结harness，合成资料不包含真实身份证或保单。每个用例分配正常授权的独立合成领队，避免把多个用例合计消耗同一个20次/小时预约预算；不修改生产限流。

覆盖会话与Origin、本人入驻/平台独立审核、待审隐私、幂等/CAS、金额与时间校验、10%服务端报价及交通食宿不抽成、跨机构私单与团队权限、冻结赛事仅声明资格且不改名单、条件场次激活、跨机构同一球员并发创建恰好一次、多场冲突整体回滚、30分钟交通缓冲、实际球员接单、逐场取消、改期双方确认和同队其他领队不能冒充交易对方、新档期竞争导致改期确认回滚、球队/平台撤权后的旧成功请求重放拒绝、历史费率快照、不可伪造已支付/已结算、报到/结束时间门槛、争议保留未来档期及独立平台RESUME/CANCEL。

最新报价契约加入 reviewedSettingsVersion / reviewedProfileVersions 后，创建helper先读取workspace快照；新增平台费率变化和球员调价后的旧报价409 QUOTE_CHANGED回归，不接受无感涨价。

## 已执行

- `prettier --write apps/api/test/player-booking.integration.test.ts docs/handoffs/C06-tests.md` 成功。
- 使用临时tsconfig把 `@small-city-basketball/contracts` 指向API作者当前C06声明，执行 `tsc --noEmit` 联编本工作树全部API源码及测试成功。临时配置仅在scratch，不进入项目；这不代表PG或新API运行通过。集成后应再运行标准typecheck。
- `git diff --check` 成功。

## 真实PG环境阻断

在root同意后，仅下载官方包并本地解包，没有系统安装。PostgreSQL server/client 18.3来自apt.postgresql.org，SHA256与既有官方Packages元数据一致；libpq5 18.6与liburing2 2.5依赖亦逐项匹配官方Packages SHA256。二进制可以加载，但本容器UID/GID映射仅 `0 0 1`：

- 对本次新建scratch和/tmp目录执行非root chown均返回 `Invalid argument`。
- `runuser -u nobody -- id` 返回 `cannot set groups: Operation not permitted`。
- `unshare --user --map-user=1000 --map-group=1000 id` 返回写uid_map `Operation not permitted`。

因此无法以真实非root身份启动PG。未使用LD_PRELOAD伪造UID、修改PG二进制或其他方式绕过PG的root拒绝。未启动任何数据库服务、未创建数据库、未开放端口；尝试创建的空data/socket目录已删除，只保留可重现的官方包缓存。

## 未执行与下一步

24项PG/HTTP用例**尚未执行**；本轮Migration仅由API作者编写，本验证树没有执行。没有真实数据库并发、重启持久化、备份恢复、浏览器或CI通过证据。生产Migration、生产部署、真实支付/通知均未执行。

root整合API和测试后先标准联编；在有真实非root PostgreSQL的隔离环境设置 `TEST_DATABASE_URL` 指向scb_test_*，运行 `npm run test:integration --workspace @small-city-basketball/api -- --exclude '**/p07-*.integration.test.ts'`。先核对本卡24项，再执行必要完整回归，按真实失败调整实现或测试；不能将本记录中的编写范围当成通过结果。
