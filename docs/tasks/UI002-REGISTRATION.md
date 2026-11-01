# UI002-REGISTRATION：报名、球队与办赛记分前端整合

状态：REVIEW；integration：LOCAL_ONLY（待root串行整合及当前候选CI）。

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

## 第二片：工作台、记分及分域31条路由

- org-event按办赛顺序聚合设置、招募、独立审核、排程、记分复核五入口，其他授权工具可展开；全部复用真实路由/API与当前权限。
- event-setup增加不丢表单的设置分区定位；entry将既有名单/资料/提交/历史四阶段接入共享步骤。跳转不提交任何业务命令，未知结果及写入中保持保护。
- scorer先呈现比分，提供阵容/换人、离线原队列、原事件及更正的定位；不获取控制权、不补造统计、不改队列或独立确认规则。未启用专业采集时明确关闭阵容入口。
- 31条分域路由复用自绘header，配套navigationStyle custom以免双导航头；其余既有完整流程保持，仅统一品牌token、可读原生字段及长文案。已有独立C11布局保留，不重新制造路由或用样例替代动态数据。
- T02球队身份卡采用5:800高保真context及原盾牌资产。6:964工作台卡、8:580比分台均取得高保真context；其余页面使用共享组件/既有流程，未宣称200画板逐页像素核验。
- 补staff-configuration、match-exceptions、recruitment、public-archives、public-archive此前缺少的正常、只读、未知结果或撤回样本；新增fixture总数17个（含首片4个），expectDisabled约束授权/独立同意/未知结果。

### 设计差异：T02管理者邀请

后端存在签发API，但现有原生transport没有签发白名单；C23保留Web-only授权管理边界。经root确认，本轮不扩大白名单或后端权限，也不以球员加入码代替管理者邀请。具备canInvite的用户可见明确关闭说明及禁用按钮，由有权网页后台签发；新增关闭态fixture。设计中的样例姓名、人数、地区、号码不覆盖API事实。

### 第二片验证

工作台/记分等定向176/176通过；之后补分区缺少目标时的正确定位、长队名及管理邀请关闭样本，直接53/53通过。最终本地完整`node --test apps/wechat/test/*.test.cjs tests/wechat-tools/devtools-ui.test.mjs`：1106通过、1项既有Windows专属跳过、0失败；Prettier与diff检查通过。新增VM验证草稿/最终同意保持、授权工作台入口、记分导航不取得控制权/补造阵容、设置定位不绕过阶段。

当前安装的Playwright默认Chromium可执行文件缺失；这里只完成真实WXML三宽模板生成，320/390/430浏览器几何、官方微信/真机、当前分支真实API、支付/保险/直播仍待root隔离CI或专项条件。本分域无后端修改、Migration编写/执行、pack、部署或生产操作。

## 追溯元数据补核

root已将5885747整合并同步到远端`c5c0f10d757bc79b0cfabfe8606475f84ea1e0a5`，PR36当前候选CI待完成。本次在原独立worktree、HEAD5885747、clean开工，只补15份fixture缺失的figmaNode，并把管理者邀请关闭样本从继承的旧C10节点9:863纠正为UI001 T02的5:787。R07=6:669、R10=6:751、R05=6:609及其他页面节点逐项匹配UI001_SCREEN_INDEX；长队名样本保留已实际读取的5:800身份卡子层。

追溯检查通过：17份fixture均有节点；本次16份变更除figmaNode外，其余元数据、合成data及expect字段与HEAD逐项相等；所有新增或纠正的节点链接均存在UI001索引。仅JSON元数据与本任务/交接变更，未重复整套测试，不改变现有应用或验证结论。

补充语义核对：按root/validation的准确追溯将招募未知结果样本对应O04 `6:1124`；记分台静态样本继承的`state: real-api`改为`synthetic-populated`，避免将合成渲染误认为真实API证据。仅这两项元数据更新，static、data、expect及实际API测试完全不变；格式、diff及元数据差异检查通过，不重跑整套测试。

## CI162真实几何失败的最小修复

root/validation提供已取消的旧CI162实际metrics：320px的c10-core-players-ready、c11-player-market-ready、players-collapsed三样本，playerCard.y期望200、实际204。原因是filter-chip虽指定height44，但继承全局button的min-height48，筛选栏实际增高4px。本片仅给players/index.wxss的.filter-chip显式补min-height44，保留原height44、触控44px及y200守卫，不修改测试预期或其他布局。

已做基本原生解析/原有球员UI回归及diff检查；本地没有可用Chromium，未声称浏览器几何复验成功，由root的下一精确候选CI验证。未增加镜像CSS字符串测试，未改业务/API或其他域。
