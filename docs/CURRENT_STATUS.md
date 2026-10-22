# 当前状态

更新时间：2026-10-22（Asia/Shanghai）

## 已完成与当前入口

- GitHub 私有仓库 `xyq-dev/small-city-basketball`，默认分支 `main`。
- 品牌「小城市篮球」、多机构商业定位及首版技术方向。
- 四组、十个关键界面概念图：观赛小程序、球队报名、机构后台、现场记分台。
- [项目开发总文档](PROJECT_DEVELOPMENT.md)：产品、UI、架构、数据、API、OBS、测试、运行规范与阶段计划。
- [多 AI 协作流程](COLLABORATION.md)、根 `AGENTS.md` / `CLAUDE.md`、[任务看板](TASKS.md)、[任务交接入口](handoffs/README.md)及实施/审查模板。

本轮 DOC001 从 `main@6911724a9f7eeb9617dd1f42f7c32f1ca8cad9fc` 开始建立文档基线0.1；该 SHA 只是源基线，不作为以后开工时的固定 HEAD。本文随本轮文档交付提交，最终提交从 Git 历史读取，验证范围见[DOC001记录](handoffs/DOC001.md)。

## main 已整合状态

P01 机构后台四页 Mock 原型已进入 `main@f15adb456c24302ce3d41587c41301e4c3931c6c`。代码提交 `819818d2f9fcee972f4c2e7854800dc6ad2415bf`，通过 [PR #1](https://github.com/xyq-dev/small-city-basketball/pull/1) 合并。可克隆后按[开发说明](DEVELOPMENT.md)运行。

远端 [Application checks #1](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742) 全部成功：安装、格式、类型、35项单测/组件测试、生产构建、官方Chromium安装及12项桌面/手机模拟E2E。原本地截图与QA浏览器限制见[P01记录](handoffs/P01.md)，不影响本次远端官方浏览器通过的独立事实。尚未部署，P01仍为内存Mock；没有真实认证、机构隔离、数据库或OBS接入的验收。

用户于2026-10-22在本会话明确“全部授权你”，已更新AGENTS；项目范围内Git、审查后合并、打包及可用环境部署/Migration可以继续，不重复索要既有授权。未配置的生产环境、微信/视频账号和付费预算不虚构为已有。

## 当前任务：P02 身份、机构与赛事基础后端

状态IN_PROGRESS。集成分支 `feat/P02-foundation` 从P01已合并基线建立，负责人为当前Codex会话；共享契约与任务卡已本地提交，API、前端接入与独立安全测试在指定独立worktree中实施，尚未验收或推送P02代码。允许路径、接口和验收见[P02任务卡](tasks/P02.md)，检查点见[P02交接](handoffs/P02.md)。

采用NestJS+pg+PostgreSQL，先验证账号/会话、机构成员与赛事分配、草稿持久化和版本冲突，不并行铺开报名/排赛/记分/直播。API模式不得失败后退回Mock；服务端是授权与数据权威。

当前环境：Node24.19.0/npm11.9.0。原生PG18.4二进制可读取版本，但容器仅UID0映射，无法chown非root用户（EINVAL）或建立新用户映射（EPERM），未启动数据库、未执行Migration。已准备GitHub CI隔离PostgreSQL18.6服务方案，用真实数据库执行集成及完整浏览器链路；在远端运行前不标通过。

文档在开工、检查点、验证及整合时更新；不是无人值守自动同步服务。

## 后续顺序

1. P01：机构后台可运行前端原型。
2. P02：机构、工作人员与赛事基础后端及数据隔离。
3. P03：球队报名、名单与资格审核。
4. P04：抽签、排赛与冲突检查。
5. P05：基础记分、赛果确认与观赛数据。
6. P06：OBS 比分包装、直播与赛后内容交付。

前端概念图中的专业统计、视频和套餐展示属于产品规划，不代表当前完成范围。
