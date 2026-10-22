# 当前状态

更新时间：2026-10-22（Asia/Shanghai）。集成人：当前Codex会话。

## main已整合

「小城市篮球」私有仓库 `xyq-dev/small-city-basketball`。当前业务基线为 `main@9fc9b3019eeef52d5b7a66643b01f0fe993af09f`；后续文档提交从Git历史读取。

- 开发总文档、四组UI概念图、多AI认领和交接规范已建立。
- P01机构后台四页Mock原型已通过PR1整合；P02持久身份、机构、赛事基础及API模式已通过PR2整合。
- **P03-A Web球队、报名审核与名单冻结已通过[PR3](https://github.com/xyq-dev/small-city-basketball/pull/3)合并，DONE / MAIN。** 代码c2d96b2f2b3801bedcb7e73258b48f5d05c88a83。外部领队个人账号及球队grant独立于机构成员；一次邀请、长期成员、不可变报名版本、独立审核、关闭后指定补交、名单冻结和撤权均已实施。当前领队及最近提交人不能自审，OWNER也不例外。

- **P04-A单循环排赛已通过[PR4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并，DONE / MAIN。** 代码7336bfa01a6a3b6afb08dd2c90260f8497b1239e。2–32队可复现对阵、机构共享Court、手工时间分配、跨赛事Court/Team冲突、休息/日期差、重抽历史及一次不可变发布已实施；其他赛制、自动排时和发布后改期仍未完成。

[Application checks 39737812114](https://github.com/xyq-dev/small-city-basketball/actions/runs/39737812114)首轮全部成功：格式、完整类型、158项单元/组件/HTTP（admin89+api69）、68项独立真实PG（P02原20+P03新增24+P04新增24）、12项Mock与8项真实API桌面/手机浏览器、两端构建。实际PG18.6重启保留session、赛事/授权、名单/freeze、正式赛程/预约、审计及迁移校验和。官方Chromium151，手机是模拟尺寸/输入，未验证Safari/微信真机。

001/002/003已在隔离测试库执行、复跑核验，没有生产DB或生产执行。P04独立API/SQL/UI静态审查无开放阻断；GitHub自动CodeReview在7336bfa已completed且无finding，自动security review未运行，不能混为同一检查。P03前两轮失败及修复保留历史。完整证据见[P04-A交接](handoffs/P04-A.md)、[P03-A交接](handoffs/P03-A.md)；截图仅合成HTTP布局证据。

## 当前重点

**P05-A基础在线记分、独立确认与私有快照处于REVIEW / BRANCH_ONLY**，实施合同见[任务卡](tasks/P05-A.md)。feature已整合API/UI及19新增PG，207项本地源码检查、完整类型/格式/构建及合成HTTP布局通过；真实PG/重启/官方浏览器仍待PR CI，未进入main，不能当成已验收。P03整体仍部分，P04整体仍有其他赛制/自动排时/改期；身份证/保险文件、微信、云视频及OBS未连接。正式榜单、公开观赛和生产部署尚未验收。默认Mock与API分别验收，API错误不能回退Mock。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复请求已有授权；未配置生产设施、真实第三方账号和付费预算不视为已有条件。文档在开工、接口变化、检查点、验证与整合时更新，不存在无人值守自动同步服务。

## 接手入口

先核验实际目录、远端、分支、HEAD和dirty，读AGENTS、[任务看板](TASKS.md)与当前卡，再按[开发说明](DEVELOPMENT.md)运行。产品、架构、数据与OBS统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。
