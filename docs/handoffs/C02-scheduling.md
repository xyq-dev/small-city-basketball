# C02 自动排时建议交接

2026-10-23（Asia/Shanghai）；负责人：auto_schedule；REVIEW / LOCAL_ONLY。

## 现场与范围

- 工作目录 `/workspace/scratch/dc6a786e1a31/c02-scheduling`，分支 `feat/C02-scheduling`，基线 `153421668ea74378df859a4b7c21df7da11ad77e`。
- root修复初始未物化worktree后状态干净；只修改 `apps/admin/src/scheduling/**` 和本交接。
- 不改API、contracts、数据库、生产、共享配置；不commit/push。

## UX与规则（实现前记录）

1. 当前DRAFT且有编辑能力才显示“生成排时建议”。仅补未分配比赛，保留所有已有分配，包括未保存的本地输入；不完整或非法输入先修正，不静默覆盖。
2. 使用本版policy、球队、启用场地窗口，并裁剪到赛事中国标准时间日期范围。稳定按轮贪心安排，检查本版场地占用、球队重叠、最少休息与开赛日期间隔。
3. 有界计算、协作式让出事件循环、允许取消。预算用尽或局部不可行返回部分建议及未排原因，不声称最优或无可行解。
4. 生成只预览，不写API；人工“采用建议”只改本地草稿，并使旧检查结果失效。用户随后使用既有保存、服务端冲突检查和发布流程。
5. 不读取或推断其他赛事的完整占用，跨赛事资源及最终可发布性由原服务端校验保证。取消、资料变化、离页或撤权不能让迟到建议覆盖新状态。

## 验证与结果

已实现：`auto-schedule.ts` 为纯有界建议器，`AutoScheduleSuggestions.tsx` 提供预览/取消/采用；ScheduleEditor接入并在计算时禁止保存/编辑，采用后使旧检查失效。SchedulePages传入真实赛事日期，CSS提供窄屏可换行的建议卡片。已有停用/越窗/冲突安排会明确要求先修正，不静默覆盖。

实际验证（本worktree，Node本地依赖）：

- `npm run test --workspace @small-city-basketball/admin -- src/scheduling`：5文件、41测试通过，其中新增12项算法和6项界面交互测试。
- `npm run typecheck --workspace @small-city-basketball/admin`：通过。
- `npm run build --workspace @small-city-basketball/admin`：通过。
- 对7个业务/测试/CSS文件执行本地Prettier格式化；`git diff --check`通过。

新增覆盖：真实休息间隔、保留dirty/未来已有安排、停用和越窗、UTC+8隔日、赛事日期裁剪及末日零时边界、双场地并行/球队冲突、局部不可行、硬预算/途中取消/输入不变；生成零写入、放弃零写入、采用仅本地、原CAS保存和服务端检查门、部分建议、预览失效、取消后的迟到成功、只读/历史隐藏。

本轮没有API/DB变更，无Migration。测试中的HTTP响应为前端单测替身，不是独立真实PG/API或真实浏览器验收。桌面/手机真实浏览器及集成后的全量检查由root继续；未验证生产、微信/Safari或OBS。

## 集成清单与限制

只需整合以下8个文件，无commit/push：

- `apps/admin/src/scheduling/auto-schedule.ts`
- `apps/admin/src/scheduling/auto-schedule.test.ts`
- `apps/admin/src/scheduling/AutoScheduleSuggestions.tsx`
- `apps/admin/src/scheduling/AutoScheduleSuggestions.test.tsx`
- `apps/admin/src/scheduling/ScheduleEditor.tsx`
- `apps/admin/src/scheduling/SchedulePages.tsx`
- `apps/admin/src/scheduling/scheduling.css`
- 本交接记录。

建议是稳定first-fit，不做全局最优或无解证明，也不获取其他赛事私有占用；用户仍需原保存、权威检查、显式发布。上限100000工作单元、最多496场/200窗口；到限返回已完整检查的部分建议和未搜索原因，可采用或手工调整。每250单元让出事件循环，取消结果不在UI采用。无覆盖模式，仅补空白。
