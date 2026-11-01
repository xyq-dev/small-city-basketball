# UI002-SERVICES 同城与新增服务前端整合

状态：IN_PROGRESS / LOCAL_ONLY。负责人：本轮 Codex ui_services；集成人 root。

2026-11-01 Asia/Shanghai；工作目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-services`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，独立分支 `work/ui002-services`，开工 HEAD `c22fde9b82454232082716271d5a09968d3c9616`，初始 clean。

允许路径：11 个分配服务路由（matching、dispatch、training、training-manage、sponsor-commerce、local-manage、local-bookings、local-matchups、booking-create、bookings、booking-detail），本任务/交接、直接相关测试与 `ui002-services-*` 合成布局样本。共享组件、主导航、API与合同由 root 负责；不改权限、资金规则、Migration或生产。

已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI001 交付和屏幕索引、REMAINING6 当前摘要。NM03 `42:1186` 高保真 Figma context 与截图已实际取得，无静态图片资产；将 React 参考适配原生 WXML/WXSS。

首片：撮合在原路由内分需求/收到意向、填写/公开范围审阅、候选/双方意向及原预约条款；保留真实API、原编号恢复、成人和独立权限门槛。尚未验证，不标完成。root 负责按切片串行同步远端。

首片验证：`node --test apps/wechat/test/r6-matching.test.cjs apps/wechat/test/ui002-services.test.cjs` 13/13通过；新增需求公开范围审阅/返回编辑不写API、未决原编号跨页保留、换账号清除审阅同意。WXML真实组件静态渲染、JS语法、定向Prettier和diff检查通过。新增候选/关闭/UNKNOWN三个合成布局样本；320/390/430浏览器、当前HEAD完整CI和微信真机尚未执行。
