# 当前状态

更新时间：2026-10-24（Asia/Shanghai）；集成人root。

## C07 球员数据与同价比较（REVIEW / BRANCH_ONLY）

当前四项审查问题均已修复并静态CLEAR（最终99bf6e8）：原买方128配额、完整授权分页、跨页面/刷新原请求恢复，以及持久终态拒绝。root最终全类型/格式/npm test1039源码（505/534）＋VM11及两端build通过；新增预约30/数据19 PG须新完整候选CI。尚未解除四线程、合并或生产执行。

用户本轮已全权授权开发、Git同步、PR及检查后合并，不再重复确认。集成目录为`/workspace/scratch/608836f8d204/small-city-basketball`，分支`feat/player-reservations`。已整合017、65表权限恢复集合、精确提名/本人同意/撤销、当前独立确认的有限公开统计与20人批量API、11项投影测试及17项PG/HTTP用例。UI已整合至6664ccd：同价同位置筛选、最多3人含费对比、近期记录/样本口径、来源提名/本人同意/撤销及viewer草稿隔离已完成。本地API534、首版全量前端442、最终13新增直接测试、类型/格式/两端build及微信VM11通过，桌面Mock浏览器实际流程通过；独立静态复核CLEAR。17项新PG与最终桌面/手机浏览器及恢复联合CI尚待，未标DONE。

普通push缺少交互凭据后，已通过连接的GitHub Git Data接口非强制同步，建立[PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)。C06基线[CI40061888579](https://github.com/xyq-dev/small-city-basketball/actions/runs/40061888579)三个job已全部SUCCESS；其源码/PG/浏览器/63表重启恢复证据已补入C06交接，历史本机/审批失败仍保留。最终C07候选本地bd5c240与远端4df2c532的tree同为3e83d4aa5962461eae82708191494df02788c339；[完整CI40062592812](https://github.com/xyq-dev/small-city-basketball/actions/runs/40062592812)中admin和隔离production全部SUCCESS，最终前端444/API534/VM11、14Mock（含新桌面/手机比较各一次）、隔离runtime16、4可信HTTPS及65表完整恢复/旧授权隔离通过，无重试。api真实PG、build和重启步骤成功，真实API浏览器仍运行；尚未合并或生产部署。详见[C07任务](tasks/C07.md)、[交接](handoffs/C07.md)和[证据](evidence/C07/README.md)。

## C06 球员赛事预约与UI（REVIEW / BRANCH_ONLY，基线完整CI通过）

真实API/016、五类合作/多人逐场/条件意向、10%费率快照、接单/变更/履约/争议与响应式UI已实现。C06基线61343528的CI40061888579三job完整SUCCESS、无重试：API523/admin431、VM11、262PG（含新24）＋runtime16、12Mock/24真实API/4HTTPS浏览器、016/63表重启与完整恢复/旧授权隔离和owned清理通过。先前本机UID与审批阻塞已保留历史并由最新授权/隔离CI解除，不再记为当前“未执行PG”。

后续C07同PR增加017及授权数据比较，原候选4df2c532的完整CI亦通过；最终配额/分页/未知建单审查修复须等待新候选CI后再合并。Cloud Chrome桌面Mock已走通系列建单/接单/双方换地点/部分取消，资金0；新增恢复组件/store50项直接测试通过。没有生产部署、正式Migration、真实个人撮合支付/分账、通知或实名/资格自动核验。详见[使用](PLAYER_BOOKING_USAGE.md)、[设计](design/PLAYER_BOOKING.md)、[C06任务](tasks/C06.md)与[C07交接](handoffs/C07.md)。

## D01商业版UI设计交付（DONE，设计及文档范围）

2026-10-24用户最新要求先做整套Figma商业版UI。root已在[原生Figma文件](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)保存10页、94张业务/状态画板（75业务含阶段/尺寸变体＋19异常/权限），另4张导览/规范/交接板；12组件组41变体、53变量12文本样式。业务页555条原型反应/18起点，封面9链接/1起点，为设计配置，未逐条浏览器演示回放。全文件结构检查、最后5页增量检查、抽样视觉及独立R02/B06/A02复核通过所列范围；8张规划界面明确P标注，E仅对齐既有Web/API能力。用户尚未视觉签收；新UI尚未写入前端或部署，应用代码与C05边界保持。详见[设计及逐画板索引](design/COMMERCIAL_UI_FIGMA.md)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)。本记录进入main仅代表文档整合，不代表新UI上线。

本轮纯设计/六份文档，无代码、依赖、Migration或正式环境修改；未重跑应用类型检查/构建/单测/PG/浏览器，不将既有CI充作新稿实现证据。接续先审阅设计，再按既有架构分批实现；C05旧库隔离升级、外部微信/支付联调、原生OBS暂缓及生产版本差异均未解除。同步前main本地/远端一致`97100fd2fb6b3e40ffcd87320b03e5ae91fcff5b`，最终文档HEAD实时读取。

## C05 已整合（DONE / MAIN，未部署生产）

2026-10-24（Asia/Shanghai），[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)已合并main `d4f6500453f293499dcc0d189c084156026db4f1`，最终source`9abeb5c8aeaf294c1df75320d0c7bf4592fc1d23`；候选与合并的tree均为`23c4620a42b0399976876fd23404fa6c8773b54f`。沿用原比赛、权限、服务器计时和独立确认，交付固定分组接淘汰、按届软件服务费/人工双人收退款/默认关闭的微信支付适配、已有账号微信绑定登录及原生小程序源码、受控文件和小视频/显式发布/人工媒体定位。[最终候选CI40001590258](https://github.com/xyq-dev/small-city-basketball/actions/runs/40001590258)三个job全部SUCCESS、无重试，完整原始日志已核对；914源码（admin410/API504）、11小程序VM、254真实PG（238+16）、12Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器通过。15Migration/checksum、58表实际PG重启、完整dump→第二实例/卷恢复及旧授权隔离、媒体实际字节/Range复核、正常和故意失败owned清理均通过。必要独立审查通过；原分组加时P2已修复并resolved/outdated。最新source自动CodeReview仍RUNNING，不能记为通过，security未运行。合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（run_attempt=1，无重试），完整原始日志已核对。没有生产部署、正式数据库/账号维护、真实资金请求或外部新凭据。任务、失败轮及证据见[C05](tasks/C05.md)、[交接](handoffs/C05.md)、[验收](evidence/C05/README.md)；操作入口见[使用指南](COMMERCIAL_USAGE.md)。

## main已整合

仓库`xyq-dev/small-city-basketball`，最新业务合并为[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)的`d4f6500453f293499dcc0d189c084156026db4f1`。后续纯文档HEAD从实际Git读取。


C04已由[PR12](https://github.com/xyq-dev/small-city-basketball/pull/12)合并main `7ef18c915ffa51712077e6668e60ec6fbb0219b6`，最终source`bc6516dc0068812c8075f9a88effa89c4183190f`与合并tree同为`5446bdacb6c5fc08fab245cecad74b91b1028a5d`。2–32队单淘汰、首轮轮空、原独立确认晋级/加时、逐轮显式发布、来源赛果锁定、最终共同名次、公开签位及闭赛/统计/恢复已整合。[CI39975284464](https://github.com/xyq-dev/small-city-basketball/actions/runs/39975284464)三个job全部SUCCESS且日志已核对：749源码（admin363/API386）、217真实PG（201+16，新增15项）、12Mock＋桌面9/手机模拟9真实API＋4可信HTTPS浏览器；11Migration/checksum、41表实际PG重启、完整dump→第二实例恢复及旧授权隔离、正常及负向owned清理均通过，无重试。最新source自动CodeReview completed无finding/未解决线程，独立静态人员维护版本P1修复已复核，security未运行。合并后CI39976904075三个job也全部SUCCESS，完整日志已核对、无重试。没有生产部署/正式DB或账号维护；详见[C04任务](tasks/C04.md)、[交接](handoffs/C04.md)和[证据](evidence/C04/README.md)。

C03已由[PR11](https://github.com/xyq-dev/small-city-basketball/pull/11)合并main `01f8ea426950b865303fd680480e507969adce20`，最终source`71451d65ae73604690057a0232e486f42796c1ac`与合并tree同为`d9ba1e527e2fc59988c518fdb9355c8bd2f49a70`。整届完赛/归档/重新开放、显式独立历史观赛、私有本届球员基础数据榜已整合；复用原比分/计时/确认/排名，闭赛业务写守卫与安全撤权例外均验收。最终[CI39941294620](https://github.com/xyq-dev/small-city-basketball/actions/runs/39941294620)三个job全部SUCCESS且完整日志已核对：660源码（admin347/API313）、202真实PG（186+16，新增17项）、12Mock＋桌面8/手机模拟8真实API＋4可信HTTPS浏览器；010/checksum、40表实际重启、完整备份恢复/旧授权隔离、正常及负向owned清理全部通过。最新source自动CodeReview completed无finding/未解决线程，独立静态及必要delta复核CLEAR，security未运行。首轮兼容错误顺序与次轮隐藏桌面表头/CI超时修复均保留[证据](evidence/C03/README.md)和[交接](handoffs/C03.md)，最终成功不拼接局部结果。合并后CI39942415842三个job亦全部SUCCESS，完整日志已核对，无重试。没有生产部署/正式DB或账号维护。

C02首批四组能力为 **DONE / MAIN**：私有逐人得分/犯规及更正确认、自动排时建议、用户名兼容登录/安全离线维护、公开SVG/CSV/打印。最终source`ec74c47`与合并tree同为`34b755e77dbcf20156b673505ee38e3b5697172f`；[CI39919192641](https://github.com/xyq-dev/small-city-basketball/actions/runs/39919192641)三job全部SUCCESS：573源码、185真实PG、12Mock＋16真实API＋4可信HTTPS桌面/手机模拟浏览器，008/009隔离执行、两种采集模式40表实际重启、完整备份恢复/隔离及owned清理通过。最终自动CodeReview无新finding/未解决线程，必要独立静态复核通过；security未运行。注册夹具429及恢复计数P1均已修复并完整重跑，详见[C02交接](handoffs/C02.md)与[证据](evidence/C02/README.md)。[合并后CI39920273639](https://github.com/xyq-dev/small-city-basketball/actions/runs/39920273639)三个job也全部SUCCESS，同范围573源码/185真实PG/12Mock＋20真实浏览器、两模式重启/完整恢复及清理均通过，无重试；没有生产部署/正式DB或账号变更。

以下PR9及更早记录保留各自历史验收范围。

P01、P02、P03-A、P04-A/B、P05-A/B、P06-A及P07-A均为 **DONE / MAIN**：多机构身份/权限、球队报名/独立审核/冻结、单循环排赛/受控正式单场改期、单端在线计分/权威时钟/独立确认、正式排名/可撤销公开观赛、独立透明比分网页，以及非root同源HTTPS包/最小DB身份/完整隔离恢复。

[PR9](https://github.com/xyq-dev/small-city-basketball/pull/9)合并`e3102e4`，source`cc10b3d54e3a8c86cf94c4c1e7cff014534b6a98`／tree`2950e03f2af0a5238b8f8844d8717f504241b231`，与本地`d566623`一致。最终[CI39871485940](https://github.com/xyq-dev/small-city-basketball/actions/runs/39871485940)三job全部SUCCESS且完整日志已读：497源码（admin237/API260）、165真实PG（149＋16）、12Mock＋14真实API＋4可信HTTPS桌面/手机模拟浏览器；完整strict/格式/build、007及checksum、40表实际重启、两次改期的完整隔离恢复/原发布不变/旧授权隔离、正常及负向owned清理均通过。最新source自动CodeReview completed无finding/未解决线程，security未运行；必要独立静态审查CLEAR。首两轮失败及最小测试修复保留于[P04-B交接](handoffs/P04-B.md)。[合并后CI39875354051](https://github.com/xyq-dev/small-city-basketball/actions/runs/39875354051)三job也全部SUCCESS，完整日志已读，同验收代码tree和上述检查范围，无重试。

[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8) source`8809d67a568b86d3ef530ec92785877c29fab80a`、tree`fcb777848e666aac9f81097bca1ddffc3130e543`与本地`dde4c27`一致；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三个job全部SUCCESS，完整日志已读：432源码（admin202/API230）、140独立真实PG（124＋16）、12Mock＋14真实API＋4HTTPS浏览器、完整strict/格式/两端build、001–006/checksum/39表实际重启，以及三非root镜像/可信TLS/完整业务链/API真实换IP且Web不变/同卷重建/完整dump→第二实例恢复精确一致→旧授权隔离/正常及负向清理均通过。

最新source自动CodeReview completed无finding/未解决线程，security未运行；API/恢复和必要delta独立静态复核通过。前五轮失败与修复完整保留于[P07-A交接](handoffs/P07-A.md)，摘要见[证据](evidence/P07-A/README.md)。合并提交同验收tree，[合并后CI39829137241](https://github.com/xyq-dev/small-city-basketball/actions/runs/39829137241)也全部SUCCESS：首次production/admin成功，api因依赖安装耗时触及job限时取消后，仅重试该任务120008473545成功；首次取消不计完整通过，没有改代码或放宽检查。

PR2四项已按最新代码核验并完成：scrypt单槽/有限队列、过期限流清理、赛事版本冲突显式刷新恢复、独立注册能力入口；不是依据线程resolved或仅CI状态判断。

## 下一步与边界

当前优先收口C06/C07修复后候选的完整CI及审查后合并；D01设计初稿和以下C05外部环境待办保留，不能把本轮实现或隔离验证当作生产发布。

C05为DONE / MAIN，最终候选的三job完整验收通过；合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（无重试），完整日志已核对。四域已落实上述有界范围，下一步为真实微信开发工具/域名/真机、真实商户沙箱与支付退款对账联调，以及旧001–007完整FINAL赛事的隔离升级演练。依赖实际账号/资质/凭据或服务器通道的工作不能在本轮虚构完成。开发代码仍有长期球员/赛季/专业统计、观众关注提醒、可靠离线、云直播/大视频/转码等后续范围，详见[商业规划](COMMERCIAL_PRODUCT_PLAN.md)及[C05使用指南](COMMERCIAL_USAGE.md)。

用户已明确授权本批开发、测试、commit/普通同步/PR、隔离CI与审查后合并；PR10/PR11/PR12/PR13已按范围执行。保留C02/C03/C04/C05及旧工作树和本地作者历史，没有reset、清理他人修改或force push。当前本地main，文档同步后的HEAD以实际Git为准。

完整商业版尚未完成。原生OBS/CEF依用户要求暂缓；手机模拟不等于Safari/微信真机。旧schema升级夹具仅旧用户/凭据，不含原007已落库FINAL完整赛事，部署前须用旧库隔离恢复副本补验，不能把本卡新schema恢复当旧库升级。

本轮没有服务器执行通道，没有生产部署、正式Migration/账号维护、付费资源、外部凭据或公网端口变更。账号维护工具已验收不等于管理员已改名或改密。C02至C05本机检查、隔离CI、以下服务器执行方旧版报告分别记录，不能混成一种证据。readiness严格核验Migration集合，不得把新DDL后直接切旧镜像当作已验回退方案。

## 服务器阶段（用户回传报告，非本会话独立实测）

2026-10-23用户回传Hermes报告：main `153421668ea74378df859a4b7c21df7da11ad77e` 已在 `https://basketball.playhubs.cn` Docker部署，项目 `scb-basketball`，服务器 `/srv/small-city-basketball`；001–007已在该项目新库执行、首owner初始化及登录通过。随后补做同镜像production模式隔离HTTPS业务/权限及桌面和手机模拟；证据据报告位于 `accept/10231320e520/`。经用户向Hermes授权后仅移除本站Basic Auth，应用登录、机构权限与观众独立授权保留，其他项目回查正常；交接在服务器 `DEPLOYMENT.md`。本会话未访问这些服务器证据，不把回传报告改记为独立复测。原生OBS、微信真机/Safari、保险凭证仍未验证；本会话未实施正式admin登录名或密码修改，也未独立复核服务器当前账号；C02只交付兼容能力，密码长度规则未降低。

## 接手入口

核验实际目录/远端/分支/HEAD/dirty/进程，再读AGENTS、[看板](TASKS.md)、当前卡和最新PR/CI。本轮目录`/workspace/scratch/dc6a786e1a31/small-city-basketball`；旧目录已消失，从原仓库精确恢复，4张大概念PNG仅未物化而原Git引用保留，详见P04-B交接。原dirty已完整保留并整合，本地历史与远端等价tree均保留，无reset/force push。开发/Git授权已核实，本轮生产操作禁令继续有效。文档随实际工作更新，停止会话后不会无人值守同步。
