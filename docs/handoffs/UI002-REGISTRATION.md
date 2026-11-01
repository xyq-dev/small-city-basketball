# UI002-REGISTRATION 交接

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。

独立目录`/workspace/scratch/5a4363d2d0b7/scb-ui-registration`，分支`work/ui002-registration`，基线`c22fde9`，初始clean；已核验远端为xyq-dev/small-city-basketball。root只负责共享组件、五导航和汇总，本分域仅写自己的业务前端路径、直接测试及本任务/交接。

当前先实施本人报名步骤与真实资料流程，保留本人资料/队伍报名/资格预审/保险/监护/最终冻结的独立事实。无需新增后端或Migration；无生产及外部通道操作。

设计：R03实际截图与表单子层6:515高保真context已获取，无资产；其他整屏首次context超时，不能宣称全量视觉核验。下一步完成首片及直接VM后，将本地提交SHA交root串行同步，再继续下片。

首片已完成：participant-materials步骤与5个显示分区、保护草稿离页、预审步骤回路和加载/空状态。root基础组件已cherry-pick到e2e01e8，未自行改共享文件。新增4个合成fixture与8个直接VM/模板用例，C23/e03/native-structure合计123/123通过；格式及diff检查通过。没有新增后端/API/Migration，真实API、浏览器布局、微信真机和外部通道本地未运行。

下片：org-event按真实capabilities分组工作台；event-setup向导、scorer显示分区，保留原控制权、离线队列与独立复核。已取得6:964工作台身份卡、8:580比分台及5:800球队身份卡的高保真context；球队卡含shield SVG需下载并核验后使用，不能以临时Figma URL运行。

首片独立审查修复：保险分区固定按钮明确调用saveInsurance；跟踪保险字段dirty并在任何资料保存/上传时合入已编辑patch，防止跨分区保存重置保单表单。3项新增VM覆盖PUT body、脱敏成功返回、422后保留非敏感编辑；定向126/126通过。首片c0accd5已由root同步远端整合分支；本修复单独提交交root同步。
