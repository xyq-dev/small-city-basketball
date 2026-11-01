# UI002-SERVICES 同城与新增服务前端整合

状态：IN_PROGRESS / LOCAL_ONLY。负责人：本轮 Codex ui_services；集成人 root。

2026-11-01 Asia/Shanghai；工作目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-services`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，独立分支 `work/ui002-services`，开工 HEAD `c22fde9b82454232082716271d5a09968d3c9616`，初始 clean。

允许路径：11 个分配服务路由（matching、dispatch、training、training-manage、sponsor-commerce、local-manage、local-bookings、local-matchups、booking-create、bookings、booking-detail），本任务/交接、直接相关测试与 `ui002-services-*` 合成布局样本。共享组件、主导航、API与合同由 root 负责；不改权限、资金规则、Migration或生产。

已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI001 交付和屏幕索引、REMAINING6 当前摘要。NM03 `42:1186` 高保真 Figma context 与截图已实际取得，无静态图片资产；将 React 参考适配原生 WXML/WXSS。

首片：撮合在原路由内分需求/收到意向、填写/公开范围审阅、候选/双方意向及原预约条款；保留真实API、原编号恢复、成人和独立权限门槛。尚未验证，不标完成。root 负责按切片串行同步远端。

首片验证：`node --test apps/wechat/test/r6-matching.test.cjs apps/wechat/test/ui002-services.test.cjs` 13/13通过；新增需求公开范围审阅/返回编辑不写API、未决原编号跨页保留、换账号清除审阅同意。WXML真实组件静态渲染、JS语法、定向Prettier和diff检查通过。新增候选/关闭/UNKNOWN三个合成布局样本；320/390/430浏览器、当前HEAD完整CI和微信真机尚未执行。

独立审查修复：matching换账号完整清除私有需求草稿、地址/地区/时段/合同、报价预览/球场选择及收费资格同意，并关闭旧账号capabilities；仅清页面pending引用，旧actor持久原编号不删除。新增VM复现A草稿不能由B重开；定向14/14通过。培训下一片仍在本地实施，不混入此安全修复。

培训片：复用当前两路由，课程列表→班次与合同→本人资料/明确付款授权→锁位状态→原交易，课程与我的报名独立视区；保留真实补课选择、逐课退款和原编号恢复。教练/教务按课表、班期、退费异议、资质排课分工作区，签到与消费分开。追加完整换号草稿清理，未修改业务API与资金状态。

设计依据：TR03 metadata及49:1639付款人字段、49:1642合同金额、43:1313固定操作区高保真context与截图；OP04/OP03 metadata及44:1692教练课表卡、44:1594课程安排卡高保真context与截图。整屏context/截图超时已终止，未冒称取得。设计中青少年/监护流程在当前T1成人实现中明确关闭，未复用赛事授权。后台1440稿转为现有有权移动工作区，未新增后台路由。

验证：`node --test apps/wechat/test/r6-training.test.cjs apps/wechat/test/ui002-services.test.cjs`25/25通过；保留全部原有结课/恢复/UNKNOWN/补课权限与真实命令断言，仅让原渲染测试解析真实全局组件注册。新增6份培训合成布局样本，累计9样本的320/390/430共27份真实WXML/WXSS兼容HTML生成成功；这不代表浏览器几何、微信运行时或真机通过。根集成CI及独立Review仍待。
