# UI002-MEDIAFLOW：直播准备与媒体流程

状态 IN_PROGRESS / LOCAL_ONLY。负责人 Codex `/root/ui_live_finance`；集成人 root。

## 开工

2026-11-01T08:33:11Z；独立目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-mediaflow`，分支 `work/ui002-mediaflow`，root 指定基线 `a9a3e10ec7793eadc2e1379fb6b776b5e7725ca6`、tree `5507fb31cadfcf5966e84f375edce8558177a3fd`。origin `https://github.com/xyq-dev/small-city-basketball.git`。独立工作区开工 clean；node_modules 仅为未跟踪依赖符号链接。根域当前 da6e076 的 teams/watch 未提交改动原样保留，未修改旧 booking/live worktree。

已读取 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、当前 UI002 和相关设计；沿用用户及 root 对开发、直接测试、本地 commit、root 串行普通同步的授权。本卡仅 live-studio/media-jobs/match-media 前端、必要显示态/原 handler dispatcher、独立测试及本卡交接；共享旧 fixture/native/E2E/catalog 由 validation 独占。无 API、后台、状态机、权限、资金、Migration、pack、部署或生产变更。

## 设计与边界

- V01 `8:1332` 完整截图已查看；`8:1345` 比赛摘要、`8:1348` 三字段的原始高保真和截图已实际读取。准备态按比赛摘要→三字段→录制选择/本次同意→正式能力 notice→固定创建重组，现有 session 的采集、暂停/停止未知、频道核对和原回执保留。
- root 明确允许保持原 record 默认 true 与原命令入参，另设 recordConsent=false 本次申请门槛；record=true 未明确同意时不创建，关闭录制请求后不要求该同意。record/账号/比赛/重新返回或隐藏变化清除本次同意；不能将申请同意称为已获独立录制授权。
- streaming workspace 只提供 match id/eventId/status，摘要显示真实状态和比赛编号，并明确对阵资料未提供；不编造设计球队名、不增后端。
- V06 `8:1567` metadata/完整截图及 `8:1609` 动作高保真/截图已读取。任务与产物先展示，校准字段显式展开，不删除时间锚点、原 job/artifact id/version、独立审批与下载规则。整行 `8:1582` context 超时，不记成功。
- V07 `8:1619` metadata、`8:1632` 表单和 `8:1656` 固定动作高保真/截图已读取；`8:1642` 确认卡 context 超时，继续读小层。原上传/分片/摘要/原编号回执、权利文本、独立 confirmOp 和目标版本复核保留；新增选择与 checkbox 仅为显示门槛，不能创造发布权限。

计划 V01/V06 第一片验证后提交并交 root 同步，再推进 V07 当前目标发布片。三宽真实布局、SDK 参考图、最终同源 PNG 与完整 CI 待 validation；旧 CI170 仅历史。

## 检查点1：V01/V06 可验证切片

2026-11-01T08:41:45Z，V01/V06 已完成本片实现，V07 尚未实施，不将三页整项记为完成。

V01 准备态先显示真实比赛状态/编号与资料缺口，再显示74px字段卡（频道选择显式展开，时长/预算实际输入保持16px及44px触区）、原录制开关、本次申请同意、能力 notice 和固定48px创建。保留原 record=true，新增 recordConsent=false；只有 record=true 时要求绑定 actor/revision/org/match 的本次勾选。字段/频道/录制选择/重新读取/返回/隐藏/账号比赛变化使勾选失效，晚到的隐藏页 checkbox 不能复原同意。原 record=false 可照原入参创建；已有 UNKNOWN 按原编号和内容恢复，不要求另一次新同意。运行 session 的采集、授权、后台停流、原回执及频道 blockers 保留。

V06 首屏为实际 job/artifact 紧凑概览，使用现有原始22px图标与16px箭头；实际记录数来自API，未捏造固定三条。时间校准由 job 展开→明确展开校准后显示原 anchorAt/offsetMs/reason 与原 job id/version CALIBRATE；下载、取消、生成、独立发布/撤回均保留原 handlers 和命令体。产物 SHA256 与真实时长/大小仍可读。

验证命令 `node --test apps/wechat/test/ui002-mediaflow.test.cjs apps/wechat/test/e01-streaming.test.cjs apps/wechat/test/native-structure.test.cjs`：91/91通过（新增真实Page6、原streaming7、结构78）。新增测试验证未勾选不写、不持久化新命令；勾选后原 CREATE(record/预算/频道/时长)；关闭录制仍传 false；actor/match/返回隐藏变更；原 UNKNOWN 重试精确相同；校准显式展开与原 id/version/回执恢复；三宽静态模板及原图标调用。

原 e01 一个视觉条件检查首次提示运行状态 blockers 被遗漏，现已恢复原运行态 blockers 显示并重跑7/7；未修改该测试。旧 ui002-live 静态 fixture 的准备态/任务区标题期望待 validation 按新版迁移，未修改其共享断言。Prettier 与 git diff --check 通过；未在本地执行浏览器几何或真机。

下一步：本片提交交 root 串行整合/同步，随后 V07 目标选择与发布同意；最终三宽/PNG/CI 仍待验。
