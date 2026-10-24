# C07 球员数据授权独立验证

2026-10-24 Asia/Shanghai；booking_tests；IN_PROGRESS / BRANCH_ONLY。

工作树 `/workspace/scratch/608836f8d204/player-data-tests`，分支 `feat/player-data-tests`，基线 `fb4f039365c10e00063fe87725a4b8e1e2942cb0`。origin为原小城市篮球仓库，开工工作区干净；已读AGENTS、当前状态/看板、COLLABORATION及root C07任务卡。

仅拥有新增 `apps/api/test/player-performance.integration.test.ts` 与本交接。使用真实HTTP与现有独立FINAL记分harness、合成身份和scb_test_*隔离库；不写生产、业务源码、迁移、共享契约或真实资料。本机PG非root限制已在C06查明，不重复下载或尝试绕过。真实PG/恢复/浏览器执行由root在已有隔离CI核验，本记录不把测试编写充作运行通过。

计划覆盖：主办方当前实际赛事权限提名、球员本人明确同意、错误成员/团队/机构配对、单边/平台角色不越权、撤销与身份/机构停用即时隐藏、仅当前独立FINAL PLAYER_BASIC、TEAM_ONLY未统计与真实0区别、重开剔除/重确认替换、来源幂等不双计、本人有限公开投影及完成服务不等于付费成交。

## 已编写

新增17项真实PG/HTTP用例：公开资料状态/会话/Origin、当前赛事数据管理权（全局EVENT_MANAGER或platform operator不豁免）、主办方明确提名＋本人明确同意、错成员/团队/机构绑定、固定名单不被改动、有限本人投影与不授予原私有API权限、真实0与TEAM_ONLY null、重开立即退出及重新独立确认只计新记录、损坏可变state时invalid且不回退旧确认、最大20人的匿名批量读取、来源幂等与唯一身份约束、双方撤销及新提名重新同意、主办角色/机构/账号停用即时隐藏、资料停用404、完成服务与付费成交严格区分，争议后的服务数剔除。

本队未归属得分与犯规同时各加1，要求本人仍仅2分/1犯规，状态PARTIAL且说明归属不完整。完整公开字段/近期记录字段白名单检查拒绝名单、私有ID、邮箱/会话泄露；未采集篮板/助攻/时间/命中率保持null，不产生实际出场数、能力分或付费成交数。

损坏state的用例只修改该owned隔离fixture的scoring_states JSON并finally恢复，保留不可变确认/名单保护。root决定“两份一致stats集合不符固定roster”的情况由API纯domain用例构造proof验证，不绕过历史触发器。

## 已执行与未执行

- 新测试与本记录的Prettier成功；`git diff --check`成功。
- 临时tsconfig将contracts映射到API作者当前C07声明，对本测试树全部API源码/测试执行严格 `tsc --noEmit` 成功。临时配置位于scratch，不提交；整合后仍须运行项目标准联编。
- 17项PG/HTTP用例尚未执行；本树未执行Migration、真实数据库并发、重启恢复、浏览器或CI，不能宣称通过。
- 未改生产、外部凭据或付费服务，未绕过本机PG UID限制。

## 接续

root整合C07 API/017及本测试后，运行标准类型与源码检查，推送已授权分支并核对本次隔离CI完整日志。PG命令沿用 `npm run test:integration --workspace @small-city-basketball/api -- --exclude '**/p07-*.integration.test.ts'`；不是只看测试编译或既有CI状态。C06后续修复与本卡运行证据分别记录。
