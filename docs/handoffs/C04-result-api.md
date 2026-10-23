# C04 赛果、公开观赛与完赛分派交接

2026-10-23（Asia/Shanghai），负责人c04_result_design；基线4b48997，分支feat/C04-result-api，目录/workspace/scratch/dc6a786e1a31/c04-result-api；origin原small-city-basketball。IN_PROGRESS / LOCAL_ONLY，修改未commit，由root统一整合。开工只有root配置的node_modules符号链接未跟踪；保留旧工作。

## 已编写

- ScoringService对单淘汰规则配置和记分执行强制OVERTIME；沿用原计时/多次加时/独立确认。resultConsumed读取不可变knockout_round_publications.sources，已被正式下轮消费的REOPEN_RESULT在幂等回放前拒绝409 KNOCKOUT_RESULT_CONSUMED，工作台canReopen同步false。event SHARE与发布event UPDATE串行化。
- StandingsService支持单淘汰的私有观赛授权管理：rules/standings=null、不配置循环赛积分；GET public event增加format、KO rules=null；公开赛程/单场沿用原whitelist。新增公开knockout端点只输出opaque球队/比赛key、展示名、轮次/胜方/最终名次；不传播seed、私有ID、确认ID、名单或控制凭据。KO调用public standings明确422；RR原规则与错误次序保留。
- 后轮发布撤销旧LIVE由bracket实现者负责；本模块只允许显式新授权覆盖当前已发布比赛，ruleset_id=null依赖011的KO精确guard。DISABLE仍可绕过损坏数据证明。
- KO生命周期用原有效确认与完整签位树计算n−1完赛门槛；未发布决赛不算完赛。归档/重开/旧键永久撤销继续复用C03。
- 私有球员榜维持一条SQL statement读取固定名单/全部当前确认/排赛来源/轮次来源证明。KO分母n−1；未物化场次计pending，轮空不造采集样本；已发布首轮全采集不能伪称整届覆盖完成。confirmed-only sourceHash不因未确认比分/计时变化而改变。
- 所有KO投影传入roundPublications，严格核验原下轮引用的确认身份/版本/胜者；无第二份比分或比赛状态。

## 路径

允许整合：apps/api/src/scoring-service.ts、standings-service.ts、event-lifecycle-service.ts、event-lifecycle-domain.ts及.test.ts、event-player-statistics-service.ts、event-player-statistics-domain.ts及.test.ts、public-viewing-controller.ts及.test.ts、新c04-public-projection.test.ts及本文档。

apps/api/src/knockout-domain.ts只是从c04-domain复制的未跟踪联编依赖，归root/domain作者，不能当本作者修改整合。node_modules及子包符号链接不整合。不写011、contracts、app.ts、汇总文档。

## 检查点

首次依赖未复制前strict仅报告缺knockout-domain；复制后strict通过。API源码初轮317项通过。新增KO覆盖/完赛直接测试后，首次strict发现fixture推导类型遗漏status/state，已显式ResultRow[]修复；针对4个文件49项运行通过。修复后的完整API strict、24文件323项源码测试、API build全部通过；git diff --check通过。最新新增10项（4 public投影/transport、3 KO完赛、3 KO球员覆盖），未把此单测范围记成真实PG或浏览器。

本机无真实PG/Docker/官方Chromium，本作者未执行真实PG、浏览器、生产、真实OBS；真实PG与全流程由专门代理/root及隔离CI验收，单测和HTTP transport stub不冒充数据库或权限实测。Migration011由bracket作者编写，未生产执行。

## 下一步

root在本地精确复制本作者允许文件，domain取其最新原作者版本，同步011/contracts/provider后运行完整检查。PG重点覆盖强制OVERTIME、已消费来源重开含replay、公开whitelist/旧键永久失效、fresh/HISTORY、完赛/球员榜n−1、跨机构与只读边界。尚未部署生产，未触碰正式账号或密码。
