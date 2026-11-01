# UI002-REGISTRATION：报名、球队与办赛记分前端整合

状态：IN_PROGRESS；integration：LOCAL_ONLY。

- 负责人：Codex `/root/ui_registration`；集成人：本轮 `/root`。
- 核验日期：2026-11-01 Asia/Shanghai。
- 独立目录：`/workspace/scratch/5a4363d2d0b7/scb-ui-registration`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 分支：`work/ui002-registration`；开工 HEAD：`c22fde9b82454232082716271d5a09968d3c9616`；初始工作区干净。
- 已读：AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI001任务、WECHAT_UI_V2及UI001_SCREEN_INDEX。
- 允许：本轮分配的报名/球队/办赛/记分页及直接测试、合成布局样本、本任务和交接；不改五导航页面、全局组件、API、合同、权限、资金规则及Migration。
- 授权：前端实施与必要测试、本地commit；由root串行同步任务分支、PR及通过审查后的整合。禁止生产、部署、新pack、Migration、真实保险/资金/消息/直播及新增凭据。

## 实施顺序

1. 本人资料的步骤、照片、外部保险、确认与进度重组；沿用原保护记录、私有API和服务端capabilities。
2. 主办方工作台和办赛向导；原排赛、名单冻结、独立赛果确认保持。
3. 现场记分、阵容、离线与事件更正分区；球队与档案入口收口。

## 设计核对与限制

R03节点`6:492`的实际截图/metadata成功读取；高保真`6:515`表单context成功，白底、圆角12、1px边线、12px间距、12px标签/14px展示值，实际输入保持项目16px要求。无静态图片资产。整屏`6:492`、`6:951`、`8:567`、`5:787`context首次均超时；继续按小层分解，未取得的页面不能宣称逐像素一致。

## 验证计划

直接VM验证步骤切换不丢草稿、不触发写API，不越过busy/pending/capabilities及未知结果保护；执行C23、C17、X03、X08、C19相关既有回归、原生结构测试；为新增正常/失败状态提供320/390/430合成布局样本。全局组件由root集成后再运行完整布局和流程CI。官方微信、真机及真实外部通道未执行。

## 首片：本人资料与资格预审

已接入root基础组件`e6c8fda`（本worktree cherry-pick为`e2e01e8`）。本人资料复用同一路由承载资料/照片/外部保单/用途确认/审核进度，三步流程贯通真实预审入口；表单分区切换不保存或修改业务事实，保留草稿及capabilities。脏草稿和原请求未知时不允许离页办理预审、保险或监护；当前账号改变时清空私有数据与所选分区。预审页增加步骤返回及加载/空状态，保留本人明确同意、逐项材料和独立审核门槛。子页不再叠加五主导航，固定操作区保留安全区。

已执行：`node --test apps/wechat/test/ui002-registration-flow.test.cjs apps/wechat/test/c23-participant-materials.test.cjs apps/wechat/test/e03-insurance.test.cjs apps/wechat/test/native-structure.test.cjs`，123/123通过；新增4个VM主线/门槛用例、4个三宽真实模板样本。Prettier及`git diff --check`通过。仅模板生成及VM，未执行浏览器几何测量、官方微信/真机、真实API或外部通道。本片交root同步后再进入工作台/记分片。

独立审查修复：首片固定保存动作原先未带保险patch，保险分区已改成明确“保存保单资料”。跟踪保险字段dirty，在其他分区保存或上传时一并保留已编辑保险patch；原证件/保单号仍在提交后清空，不把明文写入本机恢复。新增3项VM经过真实Page→repository PUT，核对保险分区及切换后保存的请求body/脱敏响应，并验证422拒绝后保留非敏感编辑与dirty。相同定向回归126/126通过。没有改变后端投保、资格、审核或未知结果规则。
