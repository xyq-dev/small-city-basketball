# UI002-LIVE：直播、保险、资金及账号服务前端

状态：REVIEW / LOCAL_ONLY（本域源码及直接验证；集成CI/视觉复核待root）。负责人：Codex `/root/ui_live_finance`；集成人：`/root`。

## 开工依据

- 目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-live-finance`；远端 `https://github.com/xyq-dev/small-city-basketball.git`。
- 分支 `work/ui002-live-finance`；基线 `c22fde9b82454232082716271d5a09968d3c9616`，开工工作区干净。
- 已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI001 交付与画板索引。真实保险驱动仍外部阻塞，正式资金/推流/通知/真机未验。
- Figma session `8360f3e4-19ce-4b52-bc6a-28aed7cc9b9b`；取得 V01 截图及摘要/字段/通知/按钮高保真 context、IN01 和 F01 完整 context。整屏 V01 context 超时，不据此宣称逐像素完成。

## 独占范围

`apps/wechat/pages/` 下 live-studio、media-jobs、media、match-media、poster、insurance、guardian、youth-review、trade-order、trade-manage、planned、messages、notification-settings、follows、account-closure、account-recovery、governance、governance-reviews、city-operations、sponsorships、public-ledgers、platform，以及直接 VM 测试、`ui002-live-*` 合成布局夹具和本任务/交接。

root 单写全局 token/组件与导航、汇总、API及共享文件。每片本地提交后由 root 串行同步；不推 main、不改 API/权限/资金规则、Migration、部署、凭据或生产。

## 首片

直播准备、采集和频道媒体分区；明确关闭态并阻止未就绪的新建/开始；保留原编号恢复、停流及撤权。保险外购/在线与原单双状态分区；资金摘要、渠道及退款扣减分区。复用 root 的 scb-state/scb-steps/header，保留真实 handler 和服务端门槛。

计划：直接 VM 生命周期/关闭态/未知结果检查；实际 WXML 三宽夹具；格式及结构检查。浏览器布局与正式微信/真实渠道分别记录，不以计划充当通过。

## 检查点1

直播工作台已接 root 组件契约，三段导航只滚动当前页面，不触发业务请求。正式能力未就绪时按钮与 handler 同时禁止新建/开始；原编号重试、暂停、停止、撤权仍保留。

`node --test apps/wechat/test/e01-streaming.test.cjs apps/wechat/test/ui002-live.test.cjs apps/wechat/test/native-structure.test.cjs`：87/87 通过。新增关闭态不出网/不新建恢复记录、关闭后旧停流命令同编号恢复、步骤跳转无业务请求三项。旧直播控制测试只隔离新增静态组件壳，仍完整解析原 WXML 且保持管理/采集分支检查。

直接 JS 格式与 `git diff --check` 通过。root 共享组件尚待整合，实际三宽浏览器、原生微信及真实渠道未执行。本片本地提交后交 root 同步，再续保险/资金等页。

## 检查点2

首片 `e059d72` 已由 root 同步远端 `feat/ui002-integration@1714a04f1acfb9477c806136f9797ed3fe8af4f6`。本分支 cherry-pick root 基础 `e6c8fda` 为测试依赖（本地 `f1472b2`，不重复交付）。

保险按办理方式、报价、原单进度分段并固定已有保单入口；付款与承保分开用中文展示，明确关闭时新报价和购买不会出网。资金保留所有原操作，新增真实金额摘要、原付款及退款扣减本页导航。媒体页增加任务/产物分段和空态。scb-state kind 已对齐 closed/unknown。

6 枚 Figma 原始 SVG 下载到各页 assets；根尺寸盾/播放/时钟/统计 22×22、箭头16×16，调用点明确相同逻辑尺寸，文件非空，无临时资源 URL 留在运行代码。

新增7个合成夹具涵盖直播关闭/未知、保险关闭/承保未知、资金冲突及媒体空/有产物。真实模板 320/390/430 的21次静态展开和本地资产检查通过；不等于浏览器几何或微信真机。

定向 `ui002-live`、`e01-streaming`、`e03-insurance`、`e04-trade`、`native-structure`：116/116 通过；格式与diff检查通过。正式渠道、浏览器三宽及真机未执行。下一片覆盖其余角色页、规则说明和全部22路由夹具。

## 检查点3：本域22条原路由整合

第二片 `637df15` 已由root同步远端 `feat/ui002-integration@a9aee06cab0e60f13fb1330c01f004c45438db44`。本片使用原路由，不新增页面或API：

| 原路由 | UI001画板 | 实际落地/复用 |
| --- | --- | --- |
| live-studio | V01—V05、V10 | 准备、采集/停流、频道/媒体三段；正式能力关闭；原操作核对 |
| media-jobs | V06 | 真实任务/产物、空态、校准/转码/集锦/授权入口 |
| media | E08 | 当前有效公开媒体及设备近期赛事；纠正旧全局关闭文案 |
| match-media | V07 | 上传、私有预览、标记、发布、撤回和恢复原流程；统一层级 |
| poster | V08 | 当前授权赛事/球员照片/赛果来源与导出历史；统一层级 |
| insurance | R06、R12、IN01—IN08 | 外购/在线、报价、原单进度三段；付款/承保分开；关闭新购 |
| guardian | R08、R11 | 资料处理、独立监护确认、分用途同意与撤回原流程 |
| youth-review | O10 | 当前角色独立审核，私密证明与资料撤权原流程 |
| trade-order | F01—F04 | 真实金额摘要/原付款/退款扣减分段；全部资金恢复门槛保留 |
| trade-manage | F05、F06 | 当前机构财务读取后展示；沿用API providerConfigured关闭日账；失权/隐藏丢弃迟到结果 |
| planned | F07 | 规则说明与真实资金订单分开；去除静态实收/退款零额和过期全局未实现断言 |
| messages | H05 | 全部/未读本地筛选已加载条目，标已读后更新；明确非全量未读计数；关注/订阅入口 |
| notification-settings | H06 | 微信能力关闭/一次订阅/原请求/撤销与站内消息原流程 |
| follows | H07 | 当前与已撤回发布分别显示，原关注和加载流程 |
| account-closure | A05 | 未完成义务与注销申请/执行分开，原密码/等待期/恢复门槛 |
| account-recovery | A04 | 正式邮件关闭、操作码、原请求核对/取消原流程 |
| governance | A06 | 本人/明确分派/平台分区、返回列表、私有附件与回复原流程 |
| governance-reviews | A07 | 真实已完订单评价、公开许可与独立审核原流程 |
| city-operations | A08 | 机构/城市/操作/有效期的现有范围与失效状态 |
| sponsorships | A09 | 机构投放、独立审核、公开赞助及有限展示统计原流程 |
| public-ledgers | A10 | 线下账目审批/更正/公示与支付余额分开；公开只读状态 |
| platform | A11 | 当前平台权限及独立审核/争议原工作台 |

22页使用统一自定义header，保留原导航返回及busy门槛；正文/表单和触控、安全区与长名称层级一致。Figma消息页/注销整屏context曾超时，后续读取其子层高保真context；没有以metadata代替完整视觉验收。部分页面只是保留既有完整功能并统一层级，不将其标为200画板逐像素验收。

新增25个 `ui002-live-*` 合成状态覆盖全部22路由，含7个过去没有填充夹具的页：poster、account-recovery、governance、governance-reviews、city-operations、sponsorships、public-ledgers。夹具使用现有Page字段及真实画板node映射，75次320/390/430静态展开、本地资产和应隐藏内容检查通过。受影响的9个旧planned夹具仅更新过期文案期望；原trade-manage夹具增加实际读取成功/通道未配置状态。

最终直接检查：`node --test` 执行 ui002-live、c10-account、e01-streaming、e03-insurance、e04-trade、e05-notifications、account-closure、youth-guardians、x18-governance、native-structure、c15-media-review、c16-delivery、c19-media-requests、live-media-download，201/201通过。新增消息筛选/标已读、财务隐藏迟到返回/通道关闭回归；全部相关格式与diff检查通过。

未执行：浏览器实际几何/PNG、官方微信编译/真机、真实支付/保险/直播/消息及生产。无API、数据库、Migration、依赖或部署变更。root下一步：整合本片，跑整套CI的三宽布局并修复真实问题，再独立审查；不得仅凭本域静态展开宣称整套UI完成。
