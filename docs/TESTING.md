# 测试与验收

更新：2026-10-22（Asia/Shanghai）。本文区分P05-B feature的阶段检查、P05-A最终验收及P04-A/P03-A/P02/P01历史证据；已编写用例、静态审查、本地检查、真实CI及生产验证分别记录，计划不等于已经执行。

## P05-B首CI及修复（未MAIN／完整CI待复验）

首CI39748395765已通过300源码、106独立PG、005隔离执行／复跑、实际PG18.6重启及12Mock；真实API的10项通过，最后2项手机场景在注册夹具触发同IP20次／小时限流429，尚未完整验收／MAIN。测试入口现改为每个浏览器project新建随机隔离库，保留生产限流，等待第二轮CI。

代码head `2c42bfd3ac9d7478a6d7aefed96aa3a3ce9dd9aa`，tree `4794efbfbee51568f98c878201defbab117e64b7`；[PR6](https://github.com/xyq-dev/small-city-basketball/pull/6)、[首CI39748395765](https://github.com/xyq-dev/small-city-basketball/actions/runs/39748395765)。admin job119722493964成功；API job119722493657只在最后浏览器步骤失败。

| 检查 | 首CI实际结果 |
|---|---|
| 格式／完整strict／两端构建 | 通过 |
| 源码／组件／HTTP | 300通过：admin145／API155，原212＋新增88 |
| 独立PG | 106通过：原88＋P05-B18，8文件，不重复计源码 |
| 001→005执行／复跑 | 隔离通过；005 hash e6c786b60b2143409b192c47398f951861be0964ac954ea5ebfd5cd2af5ac221，无生产执行 |
| 实际PG18.6重启 | 通过；规则锁、有效／撤销public身份、映射／sourceHash及原业务数据保留，非备份恢复 |
| Mock官方浏览器 | 12通过 |
| 真实API官方浏览器 | 10通过、2失败；新桌面公开完整流程通过，新手机及旧手机记分均在注册夹具429，未进入其业务流程 |
| 合成布局 | 本地native153的16状态及三图通过；非PG／OBS证据 |

首失败不删除：shared browser DB累计注册超过同IP20次／小时，scoring.spec的mobile participant与viewing.spec的mobile owner返回429。修复新增run-api-browser-checks.mjs，每project新随机隔离库；不清限流、不提高额度、不关闭Origin。base须scb_test_*且有CREATEDB，退出只清本次创建库；--list无DB连接、生产target／production模式／替换配置拒绝、本地文件filter与exact project选择已检查。实际CREATE／运行／DROP仍待第二CI；另用故意无效CLI子进程验证真实失败清理、退出码及base保留。重启指纹另外补auth_rate_limits，现覆盖全部36个migration应用表及schema_migrations，共37表；首CI为原36表，新增限流表保留待第二轮证明。

领域检查覆盖显式积分0–1000／空有序同分项、无隐式H2H／胜率、三队循环同分、1,1,3、零确认rank=null、部分完赛、确认统计守恒、来源hash已知向量／读取时间稳定、坏FINAL拒绝及staff运行版本变化不撤赛果。独立复读发现终局时钟三项缺口，已补暂停、remaining_ms=0及完成常规节条件和三个反例；这使API源码检查由152增至155，不能另算为PG用例。

新增PG源码计划覆盖规则CAS／永久锁、同一SQL来源快照及排队写入可观察性、FINAL元数据／重开／重确认、坏来源整体拒绝且DISABLE仍可用、实际赛事授权／撤权、公开身份全量／复合FK／不可变与同事务映射、匿名Cookie无关／递归白名单、公开游标、撤销竞争、重新启用及审计失败全回滚。裸SQL测试注入与实际业务API分开，不禁用生产触发器来制造成功。

重启扩展capture保存已有LIVE raw clock、FINAL两份确认及第三场未准备状态，再保存排名规则与先撤销后重建的公开身份。verify仅排除动态serverTime/asOf，仍比较raw anchor、sourceHash和所有业务字段；排名／公开写推进Event版本后重新捕获registration/scheduling及scoring规则视图。fingerprint新增standings_rulesets、public_event_publications、public_match_links，先比指纹再acquire证明fence递增。流程和比较代码已静态复核，但没有真实执行结果。

浏览器扩展使用owner／leader／scorer独立身份，独立无Cookie context在首次公开导航前监听私人auth/org/invitation请求；断言未准备null、确认入榜、重开撤出、重确认仅一次、离线陈旧提示、撤销清屏，以及新event/match/team公开身份全换。完整分页失败不冒充部分成功；实际浏览器和移动布局结论仍待后续验证及CI。详细合同见[P05-B任务卡](tasks/P05-B.md)，最终运行ID、实际计数及MAIN状态由集成人取得证据后更新，不能提前勾选。

## 已交付P05-A与证据

P01、P02、P03-A、P04-A及P05-A为DONE / MAIN。[PR #5](https://github.com/xyq-dev/small-city-basketball/pull/5)合并main `3c0bf8408b181d6e96c00b348d7cebb7bad54aef`；验收代码 `1cb8e41400de4e497580e98c7eb77d6a7a02e079`，tree `9f23899a9e118304db2749b8505d04c5468c5dfe`。[第二轮Application checks39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)两个job全部成功：[admin119706887223](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053/job/119706887223)、[API119706886917](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053/job/119706886917)。本节新增当前结果，后面的历史阶段计数原样保留。

| P05-A最终已执行检查 | 结果 | 计数或证据边界 |
|---|---|---|
| 安装、格式、完整strict类型及两端构建 | 通过 | Node24、已提交锁文件；类型检查包含PG、浏览器测试及配置 |
| `npm test` | 212项通过 | admin125＋api87；保留旧158项，新增54项（记分UI28、赛程状态兼容8、API领域／HTTP18） |
| `npm run test:integration` | 88项独立PG场景通过 | P02 20＋P03-A 24＋P04-A 24＋P05-A 20；限定test/，不重复算源码单测 |
| Migration001→002→003→004 | 隔离测试库执行及复跑校验通过 | 004七表、复合FK、不可变历史、连续seq、单次撤销、永久fence及deferred state/match版本；无生产执行 |
| PostgreSQL18.6实际重启 | 通过 | 运行中clock原锚、已释放lease/fence、事件／receipt、重开修正后两份确认、session／grant／roster／正式赛程／预约／审计／迁移checksum均保留；重取lease的fence严格增大 |
| `npm run test:e2e` | 12/12通过 | 显式Mock，保留原桌面／手机场景 |
| `npm run test:api:e2e` | 10/10通过 | 保留原8项，新增桌面／手机在线记分完整流程；使用真实API与隔离PG |
| 官方Playwright浏览器 | Chromium151.0.7922.34通过 | 桌面及手机模拟；未验Safari、微信或真机 |
| 独立静态审查及旧自动finding修复 | CLEAR／三条旧thread已resolved | API/SQL/UI及修正delta分别复核；不冒充新的自动审查完成 |
| 新source的GitHub自动CodeReview | completed，无finding | 已核验1cb8e414的新一轮结果；自动security review未运行，不混为同类检查 |
| 生产、正式排名／公开观赛、可靠离线与OBS | 未执行／未交付 | 无生产环境、生产Migration或灾备恢复演练；首卡仅在线记分与私有读取 |

新增20项PG覆盖最小单场SCORER无需EventStaff、赛事／场次／租户范围、显式规则及READY锁、两场准备／开赛锁序、双端／双tab lease、超时后的renew/release/fence、并发同命令仅一条成功、同ID异内容冲突、旧版本与旧控制拒绝、撤权先于成功重放、clock锚与归零守卫、跨节／加时、原子更正／替换、历史记分者和当前领队不可确认、Team grant激活与确认竞争、不可变确认／重开及审计回滚。成员先撤权再停用既有matchStaff的回归还覆盖uppercase UUID、旧lease立即过期、单次audit、match/sourceVersion同步，以及未知／跨机构／未分配目标拒绝后完整指纹不变。

新增两项真实浏览器使用独立准备／记分／确认身份，在桌面与手机约15／13秒完成显式规则、人员分配、取得控制、加分、时钟／更正、结束、独立确认、重开与重确认。lost ACK场景在实际命令提交后中断响应，再查原receipt，证明只计一次；offline期间停止新写，不宣称可靠离线补交。原P04页面在FINAL后仍读真实MatchStatus，publication/source hash及固定计划不变。官方浏览器业务证据与[合成HTTP布局截图](evidence/P05-A/README.md)分别记录，后者使用临时QA字体和本地Chromium153，不能替代真实API／PG验收。

重启仍由[CI](../.github/workflows/ci.yml)执行[脚本](../scripts/check-database-restart.mjs)capture→实际docker restart→verify，先比较全部指纹与业务数据，再取得新lease证明fence递增。它证明持久化和锚点连续性，不是备份恢复、生产部署、公开推送或OBS连接验收。

### P05-A失败与修复历史

| 运行 | 实际结果 | 修复及证据边界 |
|---|---|---|
| [首轮39742003544](https://github.com/xyq-dev/small-city-basketball/actions/runs/39742003544)，source c2c0e83460da2f652a656f6cae508e9c9d35a323 | 207源码检查、87独立PG、001→004／复跑checksum、实际重启、12Mock及旧8API成功；新增2记分浏览器未通过 | native nested select的精确label定位失败；原生DOM复现并补显式ARIA标签。三条自动finding涉及仅场次用户入口、失效成员停用分配和替换统计默认值，均修复并独立复核；新增5组件＋1PG回归，不删旧场景 |
| [第二轮39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)，source 1cb8e41400de4e497580e98c7eb77d6a7a02e079 | 212源码检查、88独立PG、实际PG18.6重启、12Mock及10API全部成功 | 据此验收并合并PR #5；旧三个review thread已resolved，新source自动review合并时仍running、之后completed无finding，security未运行 |

源码恢复使用已发布的1cb8e414、首轮c2c0e834及main合并3c0bf840，不把实施者未发布的本地提交当作远端恢复点。该次实际源文件SHA-256如下，004及不可变计划来源另见[DATA_MODEL](DATA_MODEL.md)：

| 文件 | SHA-256 |
|---|---|
| apps/api/migrations/004_p05_scoring.sql | ebf454ab7e5bcb86e9453bab0e9783d792f5c0755fd7621878aa96a3c997ab83 |
| apps/api/src/scoring-service.ts | 946da0ba2758c314753467bfb549525810c072dcdc9e51c387c5bf49be8dee10 |
| apps/api/src/scoring-domain.ts | 800de3ba2e3830aa4be6c66380e9462556946b83feb4ac54104c2a13cfb5bcc1 |
| apps/api/src/scoring-controller.ts | 95ba643ccced6b1b9b8a69ab603c28af221076ecd11049dbcc4f918383209bca |

## 历史P04-A交付与证据

P01、P02、P03-A、P04-A均为DONE / MAIN。P04-A代码 `7336bfa01a6a3b6afb08dd2c90260f8497b1239e` 经[首轮Application checks39737812114](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114)全部成功，[PR #4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并main `9fc9b3019eeef52d5b7a66643b01f0fe993af09f`。下表是该次执行计数；后面的历史计数原样保留。

| P04-A最终已执行检查 | 结果 | 计数或证据边界 |
|---|---|---|
| 安装、格式、严格类型及两端构建 | 通过 | 已提交锁文件、Node24；admin与api及浏览器测试配置 |
| `npm test` | 158项通过 | admin89＋api69；API包含44项新增排赛算法／时间／约束测试和原25项 |
| `npm run test:integration` | 68项独立PG场景通过 | P02 20＋P03-A 24＋P04-A 24，限定test/且不重复计入源码单测 |
| Migration001→002→003 | 隔离测试库执行通过 | btree_gist、复合FK、排他／不可变／提交约束；复跑核对SHA-256后跳过已应用文件；没有生产执行 |
| PostgreSQL18.6实际重启 | 通过 | session、授权、roster/freeze、seed及对阵、正式publication/matches、Court/Team预约、版本、审计及迁移checksum保持 |
| `npm run test:e2e` | 12/12通过 | 显式Mock，桌面／手机Chromium模拟 |
| `npm run test:api:e2e` | 8/8通过 | 原6场景及新增桌面／手机真实单循环生成、分配、冲突修正、一次发布和重读 |
| 官方Playwright浏览器 | Chromium151执行通过 | 手机为模拟尺寸及输入；未验Safari、微信或真机 |
| 独立静态审查 | SQL/API/UI CLEAR | 授权、来源／hash、版本、并发、快照及UI边界；静态结果与真实运行分别记录 |
| GitHub自动CodeReview | completed，无finding | 不等于所有安全检查已执行；自动security审查未运行 |
| 生产部署、备份恢复及第三方服务 | 未执行 | 没有生产DB、生产Migration、灾备恢复演练或OBS／微信／保险接入 |

该次两个job均成功：[admin119687549305](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114/job/119687549305)、[API119687549561](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114/job/119687549561)。P04-A首轮通过，没有新增失败轮次需要补写；详细整合记录见[P04-A交接](handoffs/P04-A.md)。

新增24项PG覆盖冻结来源／不支持格式及人数、重抽历史、全量分配双CAS、真实日期与窗口、半开边界、休息及本地日期差、实际staff及撤权、tenant隔离和分页；以及无mutex行首次并发、不同Court但同canonical Team跨赛事、旧校验后占用变化、Court停用双向竞态、不同org独立发布、审计失败不留比赛或预约、发布后的SQL改写／删除／追加防线。新增44项源码测试包含固定序列化已知向量、2–32队单循环不变量、严格时间、时长反篡改及最大496场冲突报告规模。

重启流程由[CI](../.github/workflows/ci.yml)执行[持久化脚本](../scripts/check-database-restart.mjs)的capture→实际docker restart→verify，比较业务响应及数据库指纹；普通集成测试或仅重启API不能替代该证据。以上是P04-A当时证据，只验收后台一次正式排程；记分／赛果的新增验收见当前P05-A部分，其他赛制、发布后改期、公开观赛及OBS仍未交付。

## 历史P03-A证据

P01、P02及P03-A为 **DONE / MAIN**。P03-A代码head `c2d96b2f2b3801bedcb7e73258b48f5d05c88a83` 经[Application checks run 39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)全部通过，[PR #3](https://github.com/xyq-dev/small-city-basketball/pull/3)已合并，main整合提交为 `1c4b352e4277af6a418ae46908d1aed0fcb01827`。

| P03-A最终已执行检查 | 结果 | 计数或证据边界 |
|---|---|---|
| 安装、格式、严格类型、构建 | 通过 | Node24、已提交锁文件、admin与api；类型检查包含浏览器测试及配置 |
| `npm test` | 100项通过 | admin75＋api25项单元／组件／HTTP检查，无真实DB依赖 |
| `npm run test:integration` | 44项独立PG场景通过 | 原P02 20＋P03-A 24；脚本限定`vitest run test/`，不重复计入API源码单测 |
| Migration001/002 | 隔离测试库执行通过 | 001→002顺序执行，重复运行核验SHA-256并跳过已应用迁移；非生产执行 |
| PostgreSQL重启持久化 | 通过 | 真实PostgreSQL18.6重启后session、授权、roster revisions、freeze、审计及迁移校验和保留 |
| `npm run test:e2e` | 12/12通过 | 显式Mock，桌面／手机Chromium模拟 |
| `npm run test:api:e2e` | 6/6通过 | 真实API＋独立隔离PG；每种尺寸覆盖持久草稿、报名审核冻结及API失败不退Mock |
| 官方Playwright浏览器 | Chromium151安装和执行通过 | 桌面与手机模拟，不等于Safari、微信或真机 |
| 独立静态审查及自动finding修正 | 无开放阻断 | 权限／锁／摘要响应／工作空间／邀请竞态及标签修正；具体记录见PR和交接 |
| 生产及第三方服务 | 未执行 | 无生产部署、备份恢复演练、微信、身份证核验、保险文件或OBS接入 |

P03-A真实PG场景覆盖外部账号不建机构、租户／球队隔离、邀请目标及安全重试、过期／撤销／撤权、自审禁止、规则锁定、CLOSED补交、名单版本、并发CAS与grant／审核／freeze串行、审计回滚，以及列表仅含EntrySummary而详情保留完整资料。真实浏览器保留`leader.goto(invitationLink)`，完成个人注册、指定账号接受邀请、名单提交、独立退回、关闭后补交、审核、冻结、历史保留和旧Cookie撤权；请求URL不含邀请token，浏览器不写localStorage。

### P03-A失败与修复记录

| 运行 | 实际结果 | 修复及证据边界 |
|---|---|---|
| [首轮39733327804](https://github.com/xyq-dev/small-city-basketball/actions/runs/39733327804)，dac9ebc | 97项检查、43项PG及实际重启、12项Mock通过；真实API浏览器3成功3超时 | 清理错误曾遮蔽首个等待位置；补固定阶段日志、动作限时和保留原错的cleanup。独立复现已登录同文档邀请hash未被消费，修复首次／hashchange处理；不把该缺陷称为所有超时的唯一原因 |
| [第二轮39734744498](https://github.com/xyq-dev/small-city-basketball/actions/runs/39734744498)，d9c8b5d | 98项检查、43项PG及重启通过；真实API浏览器4成功2失败 | 原持久化场景均通过，新报名均停在精确读取“邀请链接”；本地真实Chromium最小DOM复现label含textarea初值，补显式aria-label。保留精确定位及所有后续业务断言 |
| [最终39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)，c2d96b2 | 100项检查、44项独立PG、实际PG重启、12项Mock及6项API浏览器全部通过 | 包含工作空间路由、旧邀请晚回、列表摘要及可远端恢复交接引用修正；据此验收并合并PR #3 |

首两轮与修复的详细过程保留于[P03-A交接](handoffs/P03-A.md)，截图的合成HTTP fixture／临时字体边界见[P03-A证据](evidence/P03-A/README.md)。这些历史记录不替代最终成功运行，也不证明生产可用。以上是P03-A当时证据；完整P03的保险附件、球员身份及小程序尚未交付。P04-A及P05-A新增验收见上文，其他P04能力、正式排名／公开观赛及P06仍待各自验收。

## 历史P02证据

P02代码head `63b94beee51d51b02f4bade7f36baba92edceb11` 经[Application checks run 39730670229](https://github.com/xyq-dev/small-city-basketball/actions/runs/39730670229)全部通过，[PR #2](https://github.com/xyq-dev/small-city-basketball/pull/2)已合并，main整合提交为 `29c4ee4cf588e911b2e087224522b832b726d18e`。下表仅记录当时计数。

| 已执行检查 | 结果 | 计数或证据边界 |
|---|---|---|
| 安装、格式、类型、构建 | 通过 | Node24、已提交锁文件、admin与api |
| `npm test` | 71项通过 | admin51项＋api20项单测／组件／HTTP检查，不依赖真实DB |
| `npm run test:integration` | 20项独立真实PG场景通过 | 该step报告40项，包含重复运行的20项API单测，不能算40项独立数据库场景 |
| PostgreSQL重启持久化 | 通过 | 真实PostgreSQL18.6重启后会话、赛事、version、授权、审计和迁移校验和保留 |
| `npm run test:e2e` | 12/12通过 | 显式Mock，桌面／手机Chromium模拟 |
| `npm run test:api:e2e` | 4/4通过 | 真实API及隔离PG，桌面／手机Chromium模拟 |
| 官方Playwright浏览器 | Chromium151安装和执行通过 | 不依赖早期本地QA153替代路径 |
| 独立静态安全审查 | clear | 针对P02范围；不等于所有后续模块安全验收 |
| 生产、Safari／微信真机及真实第三方服务 | 未执行 | 无生产部署、生产DB或真实保险／OBS／云服务接入 |

GitHub自动CodexReview在本次整合记录时仍运行中、尚无finding，不能据此写成“自动审查通过”。其状态以后以PR记录为准。首次失败运行及修复顺序由[P02交接](handoffs/P02.md)记录，当前验收以上述成功运行和代码head为准。

Migration001当时已编写、审查并在隔离测试库执行，重复运行及校验和验证通过；不是生产执行。P03-A的新增结果单列在上文，不改写P02历史计数。启动与命令前提统一见[DEVELOPMENT](DEVELOPMENT.md)。

## 历史P01证据

P01代码819818d经PR #1合并为f15adb4，[原CI run 39728632742](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742)已通过35项单测／组件和12项官方Chromium E2E。早期本地Chromium下载失败、QA153替代及截图临时字体注入仅用于解释历史证据，不再是当前官方浏览器路径的阻断。

[P01历史manifest](evidence/P01/source-manifest.json)原样保留未提交P01工作区22文件指纹，不是当前main或P02指纹；源码恢复以Git提交为准。本地视觉检查与截图见[P01证据](evidence/P01/README.md)。这些记录不证明生产、微信、Safari或全平台功能完成。

本次文档维护只核对既有事实和链接，没有重新执行应用测试，也没有增加测试数量。

## 分阶段必测范围

| 阶段 | 必要检查与验收 |
|---|---|
| P01 前端原型 | 工作总览、赛事列表、创建赛事、赛事详情可访问；必填、边界值和取消行为正确；创建结果可在列表及详情查看；未知赛事有明确提示；加载、空、错误状态可演示；Mock 标识清楚；说明刷新是否重置数据；桌面与平板布局无关键遮挡 |
| P02 机构与权限 | 已验收适用范围：两机构、多角色、赛事详情/列表/搜索/写入授权、撤权失效、CAS及审计原子性；导出、附件、订阅等尚未实现的能力在各自阶段补专项用例 |
| P03 报名审核 | 外部领队/球员无需工作人员身份也能完成获授权流程；邀请冒领、重放、过期及撤销均正确处理；本人和领队的资料权限不同；重复报名及重复球员按规则处理；退回补资料能重新提交；提交、审核、名单冻结有版本冲突提示；球队长期成员变动不改变已冻结赛事名单；保险凭证只能由获授权角色读取，界面不把上传成功等同于审核通过 |
| P04 抽签排赛 | P04-A已验2–32队单循环、可复现seed、窗口／休息／日期及跨赛事资源冲突、双CAS、重抽历史与一次发布；种子队分组、其他赛制、自动排时及发布后改期另卡验证，不能借本次结果宣称已完成 |
| P05 记分赛果 | P05-A在线记分／独立确认／私有快照已验收；P05-B排名／公开API及测试源码已在feature实施，真实验收待执行；可靠离线和专业统计仍未交付，不借用旧通过结果 |
| P06 OBS 与内容 | 只读包装不能写比分；令牌撤销后连接失效；展示字段不含个人敏感资料；断线可恢复且不会把旧比分覆盖新比分；OBS 关闭不影响记分；比赛时钟暂停时录像时间仍独立；剪辑失败和缺素材有可重试状态 |

## 记分系统必须证明的行为

- 同一操作重发、重连重试或服务重启后重放，只计入一次；同幂等键不同内容必须拒绝。
- 两端争抢主记分权时仅有效持有者可写；租约失效后的离线端不能继续覆盖服务端结果。
- 并发记分使用已知版本校验；失败操作明确标记待处理，不能伪装成已同步。
- P05-A更正采用可追溯追加事件，重放得到相同球队基础统计；球员专业统计、榜单与公开包装一致性在后续卡单独证明。
- P05-A断网立即停止新写，未知提交先查原receipt与snapshot，不能自动新ID补分；可靠离线队列、页面销毁后命令恢复及补交另卡验证。
- 跨节、暂停、恢复、校时、更换主端及页面刷新不导致重复计时；未采集的数据展示“未统计”。

## 质量门槛与记录

小范围文档修改检查链接、事实状态及术语一致性即可；代码变更执行直接覆盖行为的检查和项目必要构建。认证授权、Migration、记分状态机需独立审查与失败场景验证；不为普通文案变更反复运行全套测试。

任务报告逐项使用“通过／失败／未执行／不适用”，失败附复现步骤；未执行说明原因及影响。阻断缺陷未关闭不得标记完成，非阻断问题进入任务清单并注明归属。P01、P02、P03-A、P04-A、P05-A已各自提供代码、实际执行及整合证据；后续阶段不能借用既有结果宣称新增能力完成。
