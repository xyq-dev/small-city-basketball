# 当前状态

更新时间：2026-10-22（Asia/Shanghai）。集成人：当前 Codex 会话。

## main 已整合

「小城市篮球」私有仓库 `xyq-dev/small-city-basketball`。当前业务基线为 `main@29c4ee4cf588e911b2e087224522b832b726d18e`；后续文档提交从 Git 历史读取，不把本 SHA 当作永久最新 HEAD。

- 开发文档、四组 UI 概念图、多 AI 认领和交接规范已建立。
- P01 四页机构后台原型已通过 [PR #1](https://github.com/xyq-dev/small-city-basketball/pull/1) 整合。
- P02 身份、机构与赛事基础后端已通过 [PR #2](https://github.com/xyq-dev/small-city-basketball/pull/2) 整合，状态 **DONE / MAIN**。代码 `63b94beee51d51b02f4bade7f36baba92edceb11`；注册/登录/退出、持久会话、当前授权、机构隔离、赛事草稿保存及并发版本检查均已实施。后台可选真实 API 模式；默认 Mock 仍明确刷新重置，不能混用两者验收。

[Application checks run 39730670229](https://github.com/xyq-dev/small-city-basketball/actions/runs/39730670229) 全部成功：格式、类型、71 项单元/组件/HTTP 检查、20 项独立 PostgreSQL 集成场景、12 项 Mock 与4项真实 API 桌面/手机浏览器测试、两端构建。实际 PostgreSQL18.6 重启后会话、赛事、版本、权限、审计历史及 Migration 校验和保留。官方 Chromium151；手机为模拟尺寸与输入，未做 Safari/真机验证。

Migration001已在隔离测试库执行并重复运行核验；未操作生产数据库。独立代码/安全审查无开放阻断；GitHub 自动 Codex Review 在核验时仍运行中，不能写成自动审查通过。首轮失败、修复及完整证据见 [P02交接](handoffs/P02.md)及[证据](evidence/P02/README.md)。

## 当前重点

P02 已关闭；下一项 **P03-A：Web 球队、报名审核及名单冻结**，先拆卡和稳定契约再开工。外部领队授权必须独立于机构成员，长期成员不能改写历史报名名单，提交与审核分权。P03–P06仍未完成；保险文件、微信、云直播、OBS 尚未连接，完整办赛闭环和生产部署未验收。

用户已明确“全部授权你”，项目范围内开发、Git、审查后合并、测试库迁移及可用环境发布可继续，不重复索要已有授权。没有配置的生产设施、账号及付费预算不作为已有条件。

文档在开工、接口变化、检查点、验证和整合时更新；不存在无人值守自动同步服务。

## 接手入口

先核验实际目录、远端、分支、HEAD及dirty，读 `AGENTS.md`、[任务看板](TASKS.md)、当前任务卡，再按[开发说明](DEVELOPMENT.md)运行。产品/架构/数据/OBS统一入口为[项目开发总文档](PROJECT_DEVELOPMENT.md)。
