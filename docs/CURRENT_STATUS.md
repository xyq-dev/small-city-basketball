# 当前状态

更新时间：2026-10-22（Asia/Shanghai）。集成人：root，当前Codex会话。

## main已整合

「小城市篮球」私有仓库 `xyq-dev/small-city-basketball`。业务基线 `main@bd38318fdfdbaeb9cfee1033c0d025e79c6cc797`；后续文档提交从Git历史读取。

P01四页Mock、P02持久身份／机构／赛事、P03-A Web球队报名审核及名单冻结、P04-A单循环排赛与一次正式发布、P05-A在线记分／服务器时钟／独立赛果确认，均已通过各自PR合并。P05-B显式排名及可撤销匿名观赛现为 **DONE / MAIN**，见[PR6](https://github.com/xyq-dev/small-city-basketball/pull/6)、[任务卡](tasks/P05-B.md)和[交接](handoffs/P05-B.md)。

第四完整CI39751848322在代码d9161e965b367ed8cb445482d57759bd34e89629（tree554284a604f3b0027d5b0eedc7dbbee20eab3119）全部成功：302源码（admin147/API155）、106独立PG、12Mock＋12API官方Chromium151.0.7922.34、格式／完整strict／两端build、001→005执行及checksum复跑、实际PG18.6重启与37表指纹。正常桌面／手机随机子库及故意失败子进程的CREATE／DROP均已验证，失败退出码保留且控制库保留。PR6已合并为main@bd38318fdfdbaeb9cfee1033c0d025e79c6cc797。

最新d916自动CodeReview已completed、无finding（comment6336377538）；非RR入口旧线程PRRT_kwDOVTBG086vG72U已resolved/outdated。自动security未运行，不能据此声称安全审计通过。

原P01证据清单不变；首CI手机注册429、第二CI被替代取消、第三CI业务全过但附加SQL bind检查失败及修复均保留。没有降低生产注册限流或放宽Origin。三张截图仅合成HTTP布局，实际功能以CI为准。

## 当前重点

下一项为[P06-A单场透明比分包装及独立只读授权](tasks/P06-A.md)。合同已独立只读审查CLEAR，三个新worktree已从main文档ca68dea89f1625c86e2a90e43ffa936c49fd6186建立并核验；P06-A现IN_PROGRESS / LOCAL_ONLY，API先精确DTO，UI/PG按独占路径开工。目标是1920×1080透明浏览器源和管理预览；尚无P06代码／迁移／浏览器或真实OBS客户端验收，不显示“OBS已连接”。

完整P03/P04仍有资料文件／小程序、其他赛制／自动优化／发布后改期；完整P05仍有可靠离线和专业统计。生产设施、保险文件、微信、视频服务和付费预算尚未配置。实际数据库重启验收不等于备份恢复验收。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复请求已有授权；不虚构缺少的环境或凭据。文档在开工、接口变化、检查点、验证与整合时更新，不存在停止会话后无人值守自动同步。

## 接手入口

先核验实际目录、远端、分支、HEAD和dirty，读AGENTS、[任务看板](TASKS.md)与当前卡，再按[开发说明](DEVELOPMENT.md)运行。统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。
