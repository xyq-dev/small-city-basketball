# UI002-LIVE：直播、保险、资金及账号服务前端

状态：IN_PROGRESS / LOCAL_ONLY。负责人：Codex `/root/ui_live_finance`；集成人：`/root`。

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
