# 当前状态

更新时间：2026-10-23（Asia/Shanghai）；集成人root。

## main已整合

仓库`xyq-dev/small-city-basketball`，最新业务合并为[PR10](https://github.com/xyq-dev/small-city-basketball/pull/10)的`e5d4782b9a3b9c79b37295c990ee0dcddec2a66a`。后续纯文档提交从实际Git读取；不把聊天或历史HEAD当最新现场。

C02首批四组能力为 **DONE / MAIN**：私有逐人得分/犯规及更正确认、自动排时建议、用户名兼容登录/安全离线维护、公开SVG/CSV/打印。最终source`ec74c47`与合并tree同为`34b755e77dbcf20156b673505ee38e3b5697172f`；[CI39919192641](https://github.com/xyq-dev/small-city-basketball/actions/runs/39919192641)三job全部SUCCESS：573源码、185真实PG、12Mock＋16真实API＋4可信HTTPS桌面/手机模拟浏览器，008/009隔离执行、两种采集模式40表实际重启、完整备份恢复/隔离及owned清理通过。最终自动CodeReview无新finding/未解决线程，必要独立静态复核通过；security未运行。注册夹具429及恢复计数P1均已修复并完整重跑，详见[C02交接](handoffs/C02.md)与[证据](evidence/C02/README.md)。[合并后CI39920273639](https://github.com/xyq-dev/small-city-basketball/actions/runs/39920273639)三个job也全部SUCCESS，同范围573源码/185真实PG/12Mock＋20真实浏览器、两模式重启/完整恢复及清理均通过，无重试；没有生产部署/正式DB或账号变更。

以下PR9及更早记录保留各自历史验收范围。

P01、P02、P03-A、P04-A/B、P05-A/B、P06-A及P07-A均为 **DONE / MAIN**：多机构身份/权限、球队报名/独立审核/冻结、单循环排赛/受控正式单场改期、单端在线计分/权威时钟/独立确认、正式排名/可撤销公开观赛、独立透明比分网页，以及非root同源HTTPS包/最小DB身份/完整隔离恢复。

[PR9](https://github.com/xyq-dev/small-city-basketball/pull/9)合并`e3102e4`，source`cc10b3d54e3a8c86cf94c4c1e7cff014534b6a98`／tree`2950e03f2af0a5238b8f8844d8717f504241b231`，与本地`d566623`一致。最终[CI39871485940](https://github.com/xyq-dev/small-city-basketball/actions/runs/39871485940)三job全部SUCCESS且完整日志已读：497源码（admin237/API260）、165真实PG（149＋16）、12Mock＋14真实API＋4可信HTTPS桌面/手机模拟浏览器；完整strict/格式/build、007及checksum、40表实际重启、两次改期的完整隔离恢复/原发布不变/旧授权隔离、正常及负向owned清理均通过。最新source自动CodeReview completed无finding/未解决线程，security未运行；必要独立静态审查CLEAR。首两轮失败及最小测试修复保留于[P04-B交接](handoffs/P04-B.md)。[合并后CI39875354051](https://github.com/xyq-dev/small-city-basketball/actions/runs/39875354051)三job也全部SUCCESS，完整日志已读，同验收代码tree和上述检查范围，无重试。

[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8) source`8809d67a568b86d3ef530ec92785877c29fab80a`、tree`fcb777848e666aac9f81097bca1ddffc3130e543`与本地`dde4c27`一致；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三个job全部SUCCESS，完整日志已读：432源码（admin202/API230）、140独立真实PG（124＋16）、12Mock＋14真实API＋4HTTPS浏览器、完整strict/格式/两端build、001–006/checksum/39表实际重启，以及三非root镜像/可信TLS/完整业务链/API真实换IP且Web不变/同卷重建/完整dump→第二实例恢复精确一致→旧授权隔离/正常及负向清理均通过。

最新source自动CodeReview completed无finding/未解决线程，security未运行；API/恢复和必要delta独立静态复核通过。前五轮失败与修复完整保留于[P07-A交接](handoffs/P07-A.md)，摘要见[证据](evidence/P07-A/README.md)。合并提交同验收tree，[合并后CI39829137241](https://github.com/xyq-dev/small-city-basketball/actions/runs/39829137241)也全部SUCCESS：首次production/admin成功，api因依赖安装耗时触及job限时取消后，仅重试该任务120008473545成功；首次取消不计完整通过，没有改代码或放宽检查。

PR2四项已按最新代码核验并完成：scrypt单槽/有限队列、过期限流清理、赛事版本冲突显式刷新恢复、独立注册能力入口；不是依据线程resolved或仅CI状态判断。

## 下一步与边界

用户要求继续剩余功能；[C03](tasks/C03.md)已实施候选，REVIEW / LOCAL_ONLY，基线main909fb74，任务分支feat/C03-event-history。优先整届完赛/归档、显式历史观赛与私有本届球员基础数据榜，API/UI/恢复驱动已独立工作树整合；本机660源码/strict/build/格式与独立静态通过，等待17项新增真实PG及浏览器/重启/恢复隔离CI，尚未合并或上线。

用户已对本批Git/PR/隔离CI请求明确回复“全部授权你去做”；提交、正常同步、PR10、必要修复/审查及合并已完成。原C01 dirty保留并随PR整合，worker及旧工作树不清理。当前本地main；纯文档同步后HEAD以实际Git为准。

本卡只交付商业首批四组能力，不代表完整商业版。后续优先整届完赛/归档与其他赛制，再补长期球员/赛季/高级统计、文件凭证、观众中心/微信、套餐/订单/支付退款对账和真实媒体，见[商业规划](COMMERCIAL_PRODUCT_PLAN.md)。OBS客户端依用户要求暂缓；手机模拟不等于Safari/微信真机。旧schema升级夹具未覆盖原007已落库FINAL完整比赛，部署前须在旧库隔离恢复副本补升级核验。

本轮没有服务器执行通道，没有生产部署、正式Migration/账号维护、付费资源、外部凭据或公网端口变更。账号维护工具已验收不等于管理员已改名或改密。C02本机检查、隔离CI、以下服务器执行方旧版报告分别记录，不能混成一种证据。readiness严格核验Migration集合，不得把新DDL后直接切旧镜像当作已验回退方案。

## 服务器阶段（用户回传报告，非本会话独立实测）

2026-10-23用户回传Hermes报告：main `153421668ea74378df859a4b7c21df7da11ad77e` 已在 `https://basketball.playhubs.cn` Docker部署，项目 `scb-basketball`，服务器 `/srv/small-city-basketball`；001–007已在该项目新库执行、首owner初始化及登录通过。随后补做同镜像production模式隔离HTTPS业务/权限及桌面和手机模拟；证据据报告位于 `accept/10231320e520/`。经用户向Hermes授权后仅移除本站Basic Auth，应用登录、机构权限与观众独立授权保留，其他项目回查正常；交接在服务器 `DEPLOYMENT.md`。本会话未访问这些服务器证据，不把回传报告改记为独立复测。原生OBS、微信真机/Safari、保险凭证仍未验证；本会话未实施正式admin登录名或密码修改，也未独立复核服务器当前账号；C02只交付兼容能力，密码长度规则未降低。

## 接手入口

核验实际目录/远端/分支/HEAD/dirty/进程，再读AGENTS、[看板](TASKS.md)、当前卡和最新PR/CI。本轮目录`/workspace/scratch/dc6a786e1a31/small-city-basketball`；旧目录已消失，从原仓库精确恢复，4张大概念PNG仅未物化而原Git引用保留，详见P04-B交接。原dirty已完整保留并整合，本地历史与远端等价tree均保留，无reset/force push。开发/Git授权已核实，本轮生产操作禁令继续有效。文档随实际工作更新，停止会话后不会无人值守同步。
