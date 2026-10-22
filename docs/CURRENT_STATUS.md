# 当前状态

更新时间：2026-10-23（Asia/Shanghai）；集成人root。

## main已整合

私有仓库`xyq-dev/small-city-basketball`，最新业务合并基线`82a3705001da50f60655b07d6174b50f4d84266f`（PR8）。后续纯文档提交从实际Git读取；不把聊天或历史HEAD当最新现场。

P01、P02、P03-A、P04-A、P05-A、P05-B、P06-A及P07-A均为 **DONE / MAIN**：多机构身份/权限、球队报名/独立审核/冻结、单循环排赛、单端在线计分/权威时钟/独立确认、正式排名/可撤销公开观赛、独立透明比分网页，以及非root同源HTTPS包/最小DB身份/完整隔离恢复。

[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8) source`8809d67a568b86d3ef530ec92785877c29fab80a`、tree`fcb777848e666aac9f81097bca1ddffc3130e543`与本地`dde4c27`一致；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三个job全部SUCCESS，完整日志已读：432源码（admin202/API230）、140独立真实PG（124＋16）、12Mock＋14真实API＋4HTTPS浏览器、完整strict/格式/两端build、001–006/checksum/39表实际重启，以及三非root镜像/可信TLS/完整业务链/API真实换IP且Web不变/同卷重建/完整dump→第二实例恢复精确一致→旧授权隔离/正常及负向清理均通过。

最新source自动CodeReview completed无finding/未解决线程，security未运行；API/恢复和必要delta独立静态复核通过。前五轮失败与修复完整保留于[P07-A交接](handoffs/P07-A.md)，摘要见[证据](evidence/P07-A/README.md)。合并提交同tree，合并后CI39829137241正在运行，其结果单独记录，不冒充已成功。

PR2四项已按最新代码核验并完成：scrypt单槽/有限队列、过期限流清理、赛事版本冲突显式刷新恢复、独立注册能力入口；不是依据线程resolved或仅CI状态判断。

## 下一步与边界

优先补原生OBS/CEF现场验收；本环境没有实际OBS客户端，不显示“OBS已连接”。手机浏览器证据为Chromium手机模拟，不是Safari/微信真机。完整P03仍有文件/小程序，P04仍有其它赛制/优化/发布后改期，P05仍有可靠离线/专业统计；媒体时间、视频、商业交付和整个平台愿景未完成。

P07-A只交付运行包和隔离演练，未生产上线。001–006未改，只在隔离测试库执行；没有新业务Migration。未修改生产数据库、部署生产、配置外部服务凭据/付费资源或开放公网端口。重新开放恢复库需外部当前授权清单和显式操作，不自动切流或推定旧授权仍有效。

## 接手入口

核验实际目录/远端/分支/HEAD/dirty/进程，再读AGENTS、[看板](TASKS.md)、当前卡和最新PR/CI。root原目录`/workspace/scratch/93747c9ad2cb/small-city-basketball`，原dirty已完整保留并整合；本地历史与远端等价tree均保留，无reset/force push。开发/Git授权已核实，本轮生产操作禁令继续有效。文档随实际工作更新，停止会话后不会无人值守同步。
