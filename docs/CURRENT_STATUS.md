# 当前状态

当前C11：`DONE（六页实现/21页兼容图集） / MAIN`。用户确认的新六屏图已实现并由[PR18](https://github.com/xyq-dev/small-city-basketball/pull/18)合并ee359af；最终source1d038743与合并完整tree0bbe4984/apps ca1a2328已实际核验一致。CI40170353262三job全部SUCCESS（attempt1）：1046源码/289原生、678三宽布局+14 Web浏览器、24真实API浏览器与隔离恢复/TLS/清理通过。448实际PNG/678JSON及六屏原稿对照已整理，独立视觉/证据复核CLEAR。官方微信/真机与用户视觉签收待办；合并后重复CI不计入候选结果。[实际截图/证据](evidence/C11/README.md)、[任务](tasks/C11.md)、[交接](handoffs/C11.md)。

当前C10：`DONE（21页源码/兼容图集） / MAIN`。PR16已合并7607c28；最终候选CI40156690255三job全部SUCCESS，271原生、654三宽布局、668浏览器及完整PG/恢复检查通过；460实际界面PNG+21原稿整包已交付。合并tree与已检候选一致；合并后独立CI尚未完成，后续仅文档同步。官方微信/真机与用户视觉签收待办。[图集/来源](evidence/C10/README.md)、[任务](tasks/C10.md)、[交接](handoffs/C10.md)。

## C09 小程序视觉修正（REVIEW / BRANCH_ONLY）

2026-10-25 Asia/Shanghai；用户指出C08展示与原Figma稿不一致，视觉签收未通过。[PR16](https://github.com/xyq-dev/small-city-basketball/pull/16) source21994add（本地09d0780，同tree7bae5137）已修正首页、球员列表、比较、预约与共享排版；232VM、96新兼容布局+14Web/实际PNG/JSON守卫及定向独立复核通过。6张新截图及原稿对照见[C09证据](evidence/C09/README.md)，单独保存在证据分支evidence/c09-mini-ui-fidelity，应用代码与候选相同。完整CI40117324334最后读取仍in_progress（admin及隔离production成功、api未结束）；未合并、未发布。C08功能/几何检查不代表视觉签收，本轮也不代表微信工具/真机或全部21页/99状态逐像素验收；[任务](tasks/C09.md)、[交接](handoffs/C09.md)继续记录。

## C08 原生小程序页面实现（DONE / MAIN；微信环境验收待办）

2026-10-24 Asia/Shanghai；[PR15](https://github.com/xyq-dev/small-city-basketball/pull/15)已合并main `0d35d4608c59015a14a60926769c162cbeb5c362`。最终source `96aa0af6192202b2b381c58f718c6dd10c69cbab`与合并tree均`49b17f4d47306df7abe1c687fee75b60fa71645d`，已实际读取核验；本地业务源09a4898同tree、保留分工历史。D01/D02整合为21条原生JS/WXML/WXSS路由，覆盖球员数据与同价含费比较、5类预约/原ID恢复/逐场履约、入驻档期/双边授权、球队/本届报名/私密材料及首页/观赛/账号/平台处理。规划资金、消息和长期档案明确未启用。

[最终CI40094090818](https://github.com/xyq-dev/small-city-basketball/actions/runs/40094090818)三个job全部SUCCESS，attempt1，无重试，原始日志已核对：1046源码（Web512/API534）、225原生VM、90原生兼容布局＋14Web Mock、289真实PG＋16隔离包PG、桌面12/手机模拟12真实API，以及65表实际重启/完整恢复、TLS/旧授权隔离、正常与故意失败owned清理。真实文件守卫与下载核验90组PNG/JSON，三宽各30、PNG高844；8张代表图/哈希与全部尺寸记录已保存。独立竞态复核通过，最新source自动CodeReview completed无finding/未解决finding，3条旧线程均修复resolved；security未运行。失败轮/工具修复如实保留，不拼接为全绿。

没有后端业务、新Migration或依赖源文件变更；既有Migration仅在隔离CI测试库执行，没有生产部署/生产Migration或正式账号维护。官方微信编译、真实AppID/合法域名、Cookie/Origin、安全随机、文件/媒体和真机均未验收，不能把VM或兼容截图当作微信已运行或上线。合并后自动检查与已通过候选分开记录，最终文档HEAD按实际Git读取。详见[使用](../apps/wechat/README.md)、[任务](tasks/C08.md)、[交接](handoffs/C08.md)、[验收与预览](evidence/C08/README.md)。

## D02小程序预约UI补全（设计DONE；接续实现见C08）

2026-10-24 Asia/Shanghai；用户要求先补齐小程序前端设计，全部设计好后统一测试。已在[原Figma文件的D02导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400)新增10–13四个分区：99张业务/状态＋2辅助画板，另三屏预览和组件审阅板；状态数量不是独立模块数量。保留D01观赛/报名原稿。补齐选人/同价与含费比较、五种预约及各模式费用核对、领队/球员分别履约、条件激活、恢复异常、入驻档期与双边数据授权/完整历史。声明默认未选中；未来真实资金、消息与长期档案7张P稿明确标记。

新增4组件组11变体，复用既有53变量/12文本样式。101源画板3893原生节点，IMAGE填充0；最终414原型反应/11起点。字体/固定文字行高/横向越界自查无所列问题，代表性视觉复核并修复组件共享默认状态、文字高度和角色分支；未逐条回放全部原型，未全部画板逐像素签收。详见[设计及逐画板索引](design/MINI_PROGRAM_BOOKING_UI.md)、[任务](tasks/D02.md)、[交接](handoffs/D02.md)、[证据](evidence/D02/README.md)。

D02设计任务仅Figma与docs文件，无应用代码/依赖/Migration/生产变化；该阶段未运行应用测试、构建、PG、微信开发工具/真机或支付联调。其后用户已要求原生实现，进展以C08新记录为准；不将设计稿或旧CI当作本次小程序实现证据。

更新时间：2026-10-24（Asia/Shanghai）；集成人root。

## C06 / C07 球员预约、授权数据及同价比较（DONE / MAIN，未部署生产）

[PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)已合并main `7d23203c2bfd57f3fd99622f286d30cd2c5d9356`，最终source `1722333d50c077cbf11efc388381c68440873dfe`；source与合并tree均为`24c7ad11055fcc0464babeba2b63aa2b3a230a05`，合并后已实际fetch核验。交付五类/多人逐场/条件意向预约、报价与履约/变更/争议、同价同位置与最多3人含费比较、当前有效独立确认的授权个人记录/近期5条/样本完整度，以及主办方精确提名/本人同意/撤销和完整授权历史分页。

[最终CI40065953550](https://github.com/xyq-dev/small-city-basketball/actions/runs/40065953550)三个job全部SUCCESS（attempt1，无重试），原始日志已核对：1046源码（admin512/API534）、微信VM11、289真实PG含预约32/数据19＋隔离runtime16、14Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器；17迁移/checksum、65表实际重启、完整dump恢复/旧授权隔离、正常/故意失败owned清理通过。六项P2均修复并在真实验证后resolved：原买方128配额、旧授权完整可达、原ID跨页面/刷新恢复、COMMIT后持久拒绝、裁定者排除球队关联、未接单不转争议而保持到期。独立静态联读CLEAR，最新source自动review completed无finding/未解决finding；security未运行。

016/017在隔离CI执行，生产未执行。助攻/篮板/时间/命中率未采集，不补0或能力总分；统计场次是冻结名单样本，不代表实际出场。实收/退款到账/分账全部0，真实个人撮合支付、通知与实名/资格自动核验未配置；没有生产部署、正式账号维护或新外部凭据。合并后自动检查尚无最终结论，不把候选CI当成合并后重复执行；合并代码tree与已验证候选相同。后续仅验收文档同步，最终文档HEAD按实际Git读取。详见[C06使用](PLAYER_BOOKING_USAGE.md)、[数据使用](PLAYER_PERFORMANCE_USAGE.md)、[C07任务](tasks/C07.md)、[交接](handoffs/C07.md)、[证据](evidence/C07/README.md)。

## D01商业版UI设计交付（DONE，设计及文档范围）

2026-10-24用户最新要求先做整套Figma商业版UI。root已在[原生Figma文件](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)保存10页、94张业务/状态画板（75业务含阶段/尺寸变体＋19异常/权限），另4张导览/规范/交接板；12组件组41变体、53变量12文本样式。业务页555条原型反应/18起点，封面9链接/1起点，为设计配置，未逐条浏览器演示回放。全文件结构检查、最后5页增量检查、抽样视觉及独立R02/B06/A02复核通过所列范围；8张规划界面明确P标注，E仅对齐既有Web/API能力。用户尚未视觉签收；新UI尚未写入前端或部署，应用代码与C05边界保持。详见[设计及逐画板索引](design/COMMERCIAL_UI_FIGMA.md)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)。本记录进入main仅代表文档整合，不代表新UI上线。

本轮纯设计/六份文档，无代码、依赖、Migration或正式环境修改；未重跑应用类型检查/构建/单测/PG/浏览器，不将既有CI充作新稿实现证据。接续先审阅设计，再按既有架构分批实现；C05旧库隔离升级、外部微信/支付联调、原生OBS暂缓及生产版本差异均未解除。同步前main本地/远端一致`97100fd2fb6b3e40ffcd87320b03e5ae91fcff5b`，最终文档HEAD实时读取。

## C05 已整合（DONE / MAIN，未部署生产）

2026-10-24（Asia/Shanghai），[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)已合并main `d4f6500453f293499dcc0d189c084156026db4f1`，最终source`9abeb5c8aeaf294c1df75320d0c7bf4592fc1d23`；候选与合并的tree均为`23c4620a42b0399976876fd23404fa6c8773b54f`。沿用原比赛、权限、服务器计时和独立确认，交付固定分组接淘汰、按届软件服务费/人工双人收退款/默认关闭的微信支付适配、已有账号微信绑定登录及原生小程序源码、受控文件和小视频/显式发布/人工媒体定位。[最终候选CI40001590258](https://github.com/xyq-dev/small-city-basketball/actions/runs/40001590258)三个job全部SUCCESS、无重试，完整原始日志已核对；914源码（admin410/API504）、11小程序VM、254真实PG（238+16）、12Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器通过。15Migration/checksum、58表实际PG重启、完整dump→第二实例/卷恢复及旧授权隔离、媒体实际字节/Range复核、正常和故意失败owned清理均通过。必要独立审查通过；原分组加时P2已修复并resolved/outdated。最新source自动CodeReview仍RUNNING，不能记为通过，security未运行。合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（run_attempt=1，无重试），完整原始日志已核对。没有生产部署、正式数据库/账号维护、真实资金请求或外部新凭据。任务、失败轮及证据见[C05](tasks/C05.md)、[交接](handoffs/C05.md)、[验收](evidence/C05/README.md)；操作入口见[使用指南](COMMERCIAL_USAGE.md)。

## main已整合

仓库`xyq-dev/small-city-basketball`，最新业务合并为[PR15](https://github.com/xyq-dev/small-city-basketball/pull/15)的`0d35d4608c59015a14a60926769c162cbeb5c362`。后续纯文档HEAD从实际Git读取。


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

C06/C07已完成完整候选验收及PR14合并；下一步按实际执行通道及恢复条件处理旧库隔离升级和部署，外部微信/支付/通知/身份核验联调仍需实际资质与凭据。D01设计与以下C05外部环境待办保留，隔离验收不等于生产发布。

C05为DONE / MAIN，最终候选的三job完整验收通过；合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（无重试），完整日志已核对。四域已落实上述有界范围，下一步为真实微信开发工具/域名/真机、真实商户沙箱与支付退款对账联调，以及旧001–007完整FINAL赛事的隔离升级演练。依赖实际账号/资质/凭据或服务器通道的工作不能在本轮虚构完成。开发代码仍有长期球员/赛季/专业统计、观众关注提醒、可靠离线、云直播/大视频/转码等后续范围，详见[商业规划](COMMERCIAL_PRODUCT_PLAN.md)及[C05使用指南](COMMERCIAL_USAGE.md)。

用户已明确授权本批开发、测试、commit/普通同步/PR、隔离CI与审查后合并；PR10/PR11/PR12/PR13/PR14已按范围执行。保留C02/C03/C04/C05及旧工作树和本地作者历史，没有reset、清理他人修改或force push。C05历史会话当时本地main；本轮集成工作树保留在feat/player-reservations，远端main已PR14合并。后续文档HEAD以实际Git读取为准。

完整商业版尚未完成。原生OBS/CEF依用户要求暂缓；手机模拟不等于Safari/微信真机。旧schema升级夹具仅旧用户/凭据，不含原007已落库FINAL完整赛事，部署前须用旧库隔离恢复副本补验，不能把本卡新schema恢复当旧库升级。

本轮没有服务器执行通道，没有生产部署、正式Migration/账号维护、付费资源、外部凭据或公网端口变更。账号维护工具已验收不等于管理员已改名或改密。C02至C05本机检查、隔离CI、以下服务器执行方旧版报告分别记录，不能混成一种证据。readiness严格核验Migration集合，不得把新DDL后直接切旧镜像当作已验回退方案。

## 服务器阶段（用户回传报告，非本会话独立实测）

2026-10-23用户回传Hermes报告：main `153421668ea74378df859a4b7c21df7da11ad77e` 已在 `https://basketball.playhubs.cn` Docker部署，项目 `scb-basketball`，服务器 `/srv/small-city-basketball`；001–007已在该项目新库执行、首owner初始化及登录通过。随后补做同镜像production模式隔离HTTPS业务/权限及桌面和手机模拟；证据据报告位于 `accept/10231320e520/`。经用户向Hermes授权后仅移除本站Basic Auth，应用登录、机构权限与观众独立授权保留，其他项目回查正常；交接在服务器 `DEPLOYMENT.md`。本会话未访问这些服务器证据，不把回传报告改记为独立复测。原生OBS、微信真机/Safari、保险凭证仍未验证；本会话未实施正式admin登录名或密码修改，也未独立复核服务器当前账号；C02只交付兼容能力，密码长度规则未降低。

## 接手入口

先核验实际目录/远端/分支/HEAD/dirty/进程，再读AGENTS、[看板](TASKS.md)、C07最终任务/交接与最新PR/CI。本轮集成目录`/workspace/scratch/608836f8d204/small-city-basketball`仍为`feat/player-reservations`；原`/workspace/scratch/dc6a786e1a31/small-city-basketball`的main工作树未被切换/reset。远端main业务已合并7d23203，最终文档HEAD另按Git读取。本地作者历史与远端聚合提交SHA不同，但各次同步tree精确核验一致；保留旧分支和工作树，无force或清理他人修改。开发/普通同步/PR/审查后合并授权已按本轮明确回复执行；生产尚未执行，未来操作仍核验实际通道、当时授权及恢复条件。文档不会在停止会话后无人值守更新。

合并后[自动CI40095117969](https://github.com/xyq-dev/small-city-basketball/actions/runs/40095117969)在本次读取时仍为in_progress；候选CI通过与合并后重复运行分列，未冒称后者已通过。其后仅同步文档和这些原图/JSON，无应用代码变化。
