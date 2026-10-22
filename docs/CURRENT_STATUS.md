# 当前状态

更新时间：2026-10-22（Asia/Shanghai）。集成人：当前Codex会话。

## main已整合

「小城市篮球」私有仓库 `xyq-dev/small-city-basketball`。当前业务基线为 `main@1c4b352e4277af6a418ae46908d1aed0fcb01827`；后续文档提交从Git历史读取。

- 开发总文档、四组UI概念图、多AI认领和交接规范已建立。
- P01机构后台四页Mock原型已通过PR1整合；P02持久身份、机构、赛事基础及API模式已通过PR2整合。
- **P03-A Web球队、报名审核与名单冻结已通过[PR3](https://github.com/xyq-dev/small-city-basketball/pull/3)合并，DONE / MAIN。** 代码c2d96b2f2b3801bedcb7e73258b48f5d05c88a83。外部领队个人账号及球队grant独立于机构成员；一次邀请、长期成员、不可变报名版本、独立审核、关闭后指定补交、名单冻结和撤权均已实施。当前领队及最近提交人不能自审，OWNER也不例外。

[Application checks 39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)全部成功：格式、完整类型、100项单元/组件/HTTP检查（admin75+api25）、44项独立真实PG场景（P02原20+P03新增24）、12项Mock与6项真实API桌面/手机浏览器、两端构建。实际PostgreSQL18.6重启后会话、赛事、授权、不可变名单、freeze、审计及迁移校验和保留；官方Chromium151，手机为模拟尺寸与输入，未验证Safari/微信真机。

Migration001/002已在隔离测试库执行、复跑及核验校验和，未操作生产数据库。首两轮浏览器失败、定位修复、自动review三项意见处理及独立最终审查见[P03-A交接](handoffs/P03-A.md)。自动review状态以PR为准，不能把运行中或无新增finding当作通过。视觉截图仅是合成HTTP布局证据，不能替代真实业务检查。

## 当前重点

接续 **P04-A：单循环对阵、手工排时与一次正式发布**，范围与开工状态见[任务卡](tasks/P04-A.md)。P03整体仍部分完成；身份证/保险文件、微信、云直播及OBS未连接。P04其余赛制、记分/赛果与内容交付尚未实施，完整办赛闭环及生产部署未验收。默认Mock与显式API模式分别验收；API错误不能回退Mock。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复请求已有授权；未配置生产设施、真实第三方账号和付费预算不视为已有条件。文档在开工、接口变化、检查点、验证与整合时更新，不存在无人值守自动同步服务。

## 接手入口

先核验实际目录、远端、分支、HEAD和dirty，读AGENTS、[任务看板](TASKS.md)与当前卡，再按[开发说明](DEVELOPMENT.md)运行。产品、架构、数据与OBS统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。
