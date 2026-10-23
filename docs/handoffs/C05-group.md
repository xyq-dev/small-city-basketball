# C05 GROUP 分组接淘汰后端交接

更新时间2026-10-24T01:25:24+08:00。负责人 c04_bracket_design；集成人 root；REVIEW / LOCAL_ONLY，未生产部署。

## 现场与权限

独立worktree `/workspace/scratch/dc6a786e1a31/c05-group`，origin原xyq-dev/small-city-basketball，分支 `feat/C05-GROUP`，基线 `ead3a62dd2dc996d11798d356c4ab96ed2b5c845`。开工仅三个依赖 node_modules symlink。复制root最新index.d.ts到本树作为联编依赖镜像，故该文件dirty但不属本作者提交；不能覆盖root共享契约。没有reset、清理旧工作或force push。

按任务卡允许本地开发、测试、显式allowlist commit；本作者不push。无app.ts/service.ts/runtime config/manifest/shared index/Admin UI修改。生产DB/Migration/部署/账号、付费资源/外部凭据/公网端口未操作。

## 实际实现

- `packages/contracts/group-knockout.d.ts` 定义配置、私有/公开分组投影、独立同分抽签、资格发布和审计proof。新增可选draftGroups供初次正式发布前核对真实服务器分组，非前端复制算法。
- `group-knockout-domain.ts`：GK_BALANCED_V1固定seed、可选至多组数的种子队分离、2/4/8组蛇形均衡；原RR对阵及显式积分规则、有效确认；同积分及显式排序仍影响前2的并列不能用ID选择，必须匹配当前来源的单次持久draw。固定A1-B2/C1-D2…及B1-A2/D1-C2…对称半区，不二次随机。资格固定来源/slots/drawID，后轮复用原C04拓扑。
- `knockout-domain.ts` 仅增加内部fixedSeats参数，严格要求恰好冻结参赛队完整二次幂集合；默认SE算法与旧行为不变。GROUP内部坐标归一化后复用该核心，再映射回正式全局轮号；没有新比分/计时状态。
- 新 `group-knockout-service/controller/repository`，GET groups、POST group-tie-commands和group-qualification-commands；独立draw提交与后续排时发布分离，失败冲突不会重抽。资格/后轮同原比赛/预约/审计事务整轮发布。原KnockoutService抽取protected view/persistRoundProof和publishRound，既有公开PUBLISH_ROUND不能绕过资格首轮显式发布。
- 原SchedulingService新增groupConfig/算法、组赛初发前锁定积分规则门禁、全部组赛来源重放和后轮父赛有向改期守卫。首次正式发布商业hook留明确注释位，root接现有商业单事务激活，不在此复制计费逻辑。
- 原scoring resultConsumed扩资格来源：资格发布后组赛不得重开；后轮源仍按原proof；合法安全人员维护不误判确认失效，使用cf.source_match_version+1固定生效版本。
- 原StandingsService支持组内RR规则管理，但不计算虚构全届RR总榜；独立公开groups只opaque team/match keys，首轮资格/新轮撤销旧LIVE，重新启用产生新键。private publicAccess/publicBundle仅改protected供媒体复用，原组织/事件/grant/purpose锁及撤销语义保留。
- 原生命周期、私有球员榜按完整组赛+2g−1计算；组赛与决赛重逢是两场有效样本，完整group拓扑验证后允许跨阶段重复对手。非晋级队不推造跨组名次，rank=null。

## 数据迁移与约束

新增 `012_c05_group_knockout.sql`，SHA256 `3abc4b3268abf76021d53a41b67d1bd8fee04a81c071e1e8785d270ea32a09f0`；原001–011未修改。新增不可变 `group_tiebreak_draws` 与 `group_qualification_publications`，runtime只SELECT/INSERT、无UPDATE/DELETE，备份SELECT。新schedule_revisions.group_config只初次INSERT，原revision source guard保护不可变。后轮round范围按全局offset放宽至31，原SE byes分支仍原逻辑。

SQL按原锁定积分规则自行重算每组前2，不信任客户端qualifiers；draw排序重放同JS SHA256种子字节串；精确确认来源、真实冻结归属、fixed cross seats与整轮fixtures/matches/一场地两球队预约/event版本deferred提交。分组首发与当前公开比赛数严格按均衡组数及完整总数校验。

Migration仅已编写，未在本机执行。当前无Docker/psql入口，真实PG及全部新DDL/最小ACL/恢复必须由隔离CI完成；独立静态审查不等于PG执行。

## 实际验证

| 检查                         | 结果与边界                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| API typecheck                | 通过，包含新PG测试静态编译；不是PG执行                                                                                                                |
| API build                    | 通过                                                                                                                                                  |
| API源码最终全跑              | 26文件、404测试通过（原386+新18）                                                                                                                     |
| 新纯domain18测试             | 单独通过；2/4/8组、均衡/种子、0/1/3排序项、三队循环同分、draw重放、资格/完整KO、同组决赛重逢、人员维护固定来源、32队2组首KO round16/决赛17的243场闭环 |
| 格式与diff                   | 获分配TS/合同prettier通过、git diff --check通过                                                                                                       |
| 真实PG                       | 5项测试已编写，未执行：真实组赛/资格/全链、个人统计重赛、独立draw/失败排时不重抽/并发唯一、2/4/8组、匿名/租户/角色、历史撤销/不可变proof              |
| 浏览器/Docker/HTTPS/完整恢复 | 本作者未运行，root统一隔离CI验收                                                                                                                      |

新增排序项测试首版it.each参数使用错误（3条失败且strict报错），已改为对象参数并完整重跑404源码及strict通过；没有放宽业务断言。此前400通过是新增4条扩展前结果，最终404为完整当前源码结果。

## root接线与恢复第一步

1. cherry-pick本作者allowlist提交；不纳本树index镜像与node_modules symlink。
2. root index出口新增group契约、algorithm GK与optional groupConfig、GROUP public format（此前已由root整合）；最新版子合同含draftGroups。
3. 原SCB_KNOCKOUT_SERVICE必须使用GroupKnockoutService实例（继承原SE，兼容旧controller），另注册GroupKnockoutController与SCB_GROUP_KNOCKOUT_SERVICE同实例。原SchedulingService仍原实例。
4. SchedulingService.publishRevision中 `C05 commercial activation hook` 注释位在validation.valid后、初始publication INSERT前，持org mutex/event UPDATE。调用已审商业激活；GROUP完整预计场数=generateGroupPairings.fixtures.length+groupCount*2−1，SE=n−1，RR=n(n−1)/2。
5. 两新表最小ACL/manifest/完整恢复/指纹及15Migration总数由root与其它模块共同整合。真实PG/浏览器/完整恢复未过前不能标DONE/MAIN。

没有push/PR/merge或生产变更；后续准确Git提交由实际commit记录获取。旧007已落库FINAL全赛事升级夹具缺口未在本子项补验，不把本项新schema PG计划当旧库升级证据。
