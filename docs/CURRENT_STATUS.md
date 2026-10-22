# 当前状态

更新时间：2026-10-22（Asia/Shanghai）。集成人：当前Codex会话。

## main已整合

「小城市篮球」私有仓库 `xyq-dev/small-city-basketball`。当前业务基线为 `main@3c0bf8408b181d6e96c00b348d7cebb7bad54aef`；后续文档提交从Git历史读取。

- 开发总文档、四组UI概念图、多AI认领和交接规范已建立。
- P01机构后台四页Mock原型已通过PR1整合；P02持久身份、机构、赛事基础及API模式已通过PR2整合。
- **P03-A Web球队、报名审核与名单冻结已通过[PR3](https://github.com/xyq-dev/small-city-basketball/pull/3)合并，DONE / MAIN。** 代码c2d96b2f2b3801bedcb7e73258b48f5d05c88a83。外部领队个人账号及球队grant独立于机构成员；一次邀请、长期成员、不可变报名版本、独立审核、关闭后指定补交、名单冻结和撤权均已实施。当前领队及最近提交人不能自审，OWNER也不例外。

- **P04-A单循环排赛已通过[PR4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并，DONE / MAIN。** 代码7336bfa01a6a3b6afb08dd2c90260f8497b1239e。2–32队可复现对阵、机构共享Court、手工时间分配、跨赛事Court/Team冲突、休息/日期差、重抽历史及一次不可变发布已实施；其他赛制、自动排时和发布后改期仍未完成。

- **P05-A基础在线记分、服务器时钟与独立赛果确认已通过[PR5](https://github.com/xyq-dev/small-city-basketball/pull/5)合并，DONE / MAIN。** 代码1cb8e41400de4e497580e98c7eb77d6a7a02e079。显式规则、最小场次授权、单端lease/fence、幂等收据、球队基础统计、追加更正、独立确认和保留旧结果的重开均已验收；私有快照不含写凭据，断网停止新写，未交付可靠离线队列。

[最终CI39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)全部成功：格式、完整strict类型、212项源码/组件/HTTP（admin125/API87）、88项独立真实PG（原68+P05新增20）、12Mock与10API桌面/手机浏览器及两端构建。实际PG18.6重启保留session、grant、名单/freeze、正式赛程/预约、运行时钟锚、单调fence、事件/收据、两次确认历史、审计和迁移checksum。官方Chromium151.0.7922.34；手机模拟尺寸/输入，未验Safari/微信真机。

001→004已在隔离测试库执行及复跑校验，没有生产DB或生产执行。独立API/SQL/UI及修复审查CLEAR；首head自动CodeReview的3项有效finding已修复、线程resolved，新head自动CodeReview随后completed且无finding，自动security未运行，两类检查分别记录。首CI新2浏览器label失败和修复保留[P05-A交接](handoffs/P05-A.md)与[证据](evidence/P05-A/README.md)。P04首轮CI39737812114的158/68/12+8及P03历史保持，见各阶段交接；截图仅合成HTTP布局。

## 当前重点

P05-B已从文档main2dd0ba64建立三个独立worktree并正式开工，见[任务卡](tasks/P05-B.md)；共享DTO及API已同步远端feat/P05-standings-public@8ef7ee29；API/UI及18项新增PG源码已整合。本地300项源码（admin145/API155）、完整格式/strict/build、native153的12Mock通过；16状态合成布局及API/SQL/UI/PG独立静态CLEAR，终局时钟及长队名缺口已修。005仍未执行，真实PG/重启/API浏览器待PR CI，尚未验收；推进显式单循环积分/同分规则和主办方选择启用的公开观赛；完整P05还需可靠离线与专业统计。P03整体仍部分，P04仍有其他赛制/自动排时/改期；身份证/保险文件、微信、云视频及OBS未连接。正式榜单、公开观赛和生产部署尚未验收。默认Mock与API分别验收，API错误不能回退Mock。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复请求已有授权；未配置生产设施、真实第三方账号和付费预算不视为已有条件。文档在开工、接口变化、检查点、验证与整合时更新，不存在无人值守自动同步服务。

## 接手入口

先核验实际目录、远端、分支、HEAD和dirty，读AGENTS、[任务看板](TASKS.md)与当前卡，再按[开发说明](DEVELOPMENT.md)运行。产品、架构、数据与OBS统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。
