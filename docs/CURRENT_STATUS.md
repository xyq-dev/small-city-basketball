# 当前状态

更新时间：2026-10-23（Asia/Shanghai）。集成人：root，当前Codex会话。

## main已整合

「小城市篮球」私有仓库`xyq-dev/small-city-basketball`，最新业务基线main@f8af5c99fba294a40334c49a5d2e32f80c6acbf9；后续文档提交从Git历史读取。

P01四页Mock、P02持久身份／机构／赛事、P03-A Web球队报名审核及名单冻结、P04-A单循环排赛与一次正式发布、P05-A在线记分／服务器时钟／独立赛果确认、P05-B显式排名及可撤销匿名观赛，以及P06-A单场透明比分包装与独立只读授权，均为 **DONE / MAIN**。

[PR7](https://github.com/xyq-dev/small-city-basketball/pull/7)已合并为`f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，源`addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`／tree`2a719b4b3e8fd4f67996144c687f5bbb72902519`。最终[CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)两job全部成功：372源码（admin171/API201）、123独立PG、12Mock＋7桌面／7手机真实API、格式／完整strict／两端build、001→006与checksum、实际PG18.6重启39表指纹，正常及故意失败子库清理均通过且control保留。官方Chromium151.0.7922.34；完整日志已读。自动addeb CodeReview completed无finding，旧文档P2已resolved/outdated；security未运行。

P06-A实际覆盖未公开赛事独立签发、fragment立即清除、Cookie刷新／原URL重复授权、透明像素、真实老化时钟、确认／重开、轮换／撤销清屏、真实1分钟到期、断网30秒清屏／恢复和迟到响应不复活。首CI39756976748同样全成功，后续仅修正文档恢复点；见[交接](handoffs/P06-A.md)。原P01证据清单不改。

## 当前重点

接续[P07-A同源HTTPS自托管包与隔离备份恢复](tasks/P07-A.md)，合同经独立技术只读审查CLEAR，合同main f2bf36585f09a0e55df41328a1d25f33e479e012已同步；从该点建立五个独立worktree，实施分支feat/P07-production现REVIEW / BRANCH_ONLY，PR8 source8905d41，首CI39822056375运行中。交付目标为非root镜像、显式迁移／首owner、受审计DB身份及完整dump→全新隔离恢复；原root@0e11776及API/DB dirty已完整保留并整合，本地`3049927`与远端`8905d41`同tree；432项本地源码测试、完整类型／构建通过。尚无本卡容器／TLS／恢复验收。

没有生产主机／域名／证书、微信或视频账号／付费预算。P06-A尚无原生OBS／CEF验收，不显示“OBS已连接”。实际PG重启不等于备份恢复。完整P03/P04仍有资料文件／小程序、其他赛制／自动优化／发布后改期；完整P05仍有可靠离线和专业统计。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复请求已有授权；不虚构缺少的环境或凭据。文档在开工、接口变化、检查点、验证与整合时更新，停止会话后不会无人值守同步。

## 接手入口

先核验实际目录、远端、分支、HEAD和dirty，读AGENTS、[任务看板](TASKS.md)与当前卡，再按[开发说明](DEVELOPMENT.md)运行。统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。

本轮接续记录见[P07-A交接](handoffs/P07-A.md)。PR2四项按最新代码核验：四项均已实现并具备源码回归；新增过期限流真实PG回归与P07共14项真实PG仍待CI。仅沿用已核实的开发/Git授权，本轮禁止生产部署、生产数据库变更、付费资源、新凭据和公网端口。
