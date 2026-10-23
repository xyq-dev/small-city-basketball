# C02-ui 逐人基础统计 Web

2026-10-23（Asia/Shanghai），负责人 stats_ui；IN_PROGRESS / BRANCH_ONLY。

## 现场与范围

目录 `/workspace/scratch/dc6a786e1a31/c02-ui`；分支 `feat/C02-ui`；HEAD `153421668ea74378df859a4b7c21df7da11ad77e`；远端 `https://github.com/xyq-dev/small-city-basketball.git`。新 worktree 初始物化问题由 root 修复，开始写入前工作区干净。

仅写 scoring UI、其 API adapter 与直接测试、本交接；不写 RuntimeApp、viewing、contracts、DB 或共享配置；不 commit/push/部署/生产操作。

## UX 与冻结约束

- 准备比赛前，具备 canPrepare 的人员可选择球队记分或逐人基础统计，说明模式准备后不可更改；缺省球队记分保持旧比赛兼容。
- PLAYER_BASIC 模式每侧在原记分按钮前选择名单球员或“未归属球员”；一次命令同时更新球队与个人，暂停不携带球员归属。离线、失去租约、资料陈旧及未知命令状态沿原规则禁写。
- 只读个人统计表列号码、姓名、得分及犯规，显示未归属与得分覆盖；篮板/助攻等未采集项目明确“未统计”。TEAM_ONLY 不伪造个人零值。
- 更正框在原撤销/补录/替换流程中增加归属选择。替换先带入原球员；切换球队清空为未归属，避免将主队球员错误用于客队。
- 个人统计来自同一权威 snapshot；确认弹窗固定已审阅版本，历史确认显示对应不可变快照，不从当前名单或当前统计回填历史。
- 个人资料仅私有认证工作台展示，匿名页不扩范围。

## 验证计划

API guard 的个人/球队一致性与无效个人资料拒绝；模式选择；球员/未归属命令；补录与替换归属；TEAM_ONLY、权限禁写；确认历史与刷新。类型、相关测试及构建由本轮实际结果追加；真实 PG/浏览器由 root 统一执行，未执行不算通过。

## 已完成与实际验证

- 采集模式准备、双方球员选择、个人/未归属统计、只读显示、高级未采集语义已实现。
- 更正可初始化原归属，切换球队清除旧球员；TIMEOUT不携带球员；原TEAM_ONLY命令未补新默认字段。
- 确认弹窗固定个人快照并在版本变化时禁确认；历史确认使用历史playerStatistics，而非当前值。
- API adapter校验个人统计结构、非负安全整数、重复memberId、个人+未归属与球队得分/犯规一致，PLAYER_BASIC缺名单拒绝；旧TEAM_ONLY响应兼容。
- 本地 `npm run typecheck --workspace @small-city-basketball/admin` 通过。
- 本地 `npm run test --workspace @small-city-basketball/admin -- --maxWorkers=2`：28文件、251测试通过；新增14项（9个UI/更正/确认历史场景，5个adapter正负向场景）。首轮新测试因缺少jest-dom import失败，补齐测试环境import后通过，没有放宽业务断言。
- 本地 `npm run build --workspace @small-city-basketball/admin` 通过；Prettier处理本轮8个代码/CSS文件；`git diff --check`通过。
- 未执行真实PG、真实浏览器或生产验收；根集成人另补真实HTTP桌面/手机用例。

## 交付路径与依赖镜像

实现文件：`apps/admin/src/api/scoring.ts`、`apps/admin/src/scoring/{Dialogs.tsx,Workbench.tsx,PlayerStatistics.tsx,PlayerStatistics.test.tsx,api.test.ts,scoring.css,test-fixtures.ts}`、本交接。

`packages/contracts/index.d.ts`仅依root批准从stats_contract工作树复制作本地依赖镜像，SHA256 `2a21eb6df7e74dde378278aca2978300008e22a79f19b7540f692fa0b11f39ab`；**不纳入UI交付，不反向覆盖root的backend权威版本**。index.js同期复制内容与HEAD相同，无差异。未commit/push。

固定浏览器选择器：`统计采集模式`（TEAM_ONLY/PLAYER_BASIC）、`主队球员归属`、`客队球员归属`、`统计归属球员`。球员选择空字符串代表未归属。统计表aria-label为`<队名>球员基础统计`。
