# R6TRAIN 成人培训招生实现

状态：IN_PROGRESS；integration：LOCAL_ONLY。2026-11-01 Asia/Shanghai。
负责人：/root/implement_training；集成人：/root。
目录：/workspace/scratch/aad368826b09/scb-six-training；远端：https://github.com/xyq-dev/small-city-basketball.git；分支work/r6-training；基线c61ab3667c9d3f756244a28046b9ee2395ccac00，开工clean。

范围：培训专项T0/T1的持久课程、审核、排课、席位/候补、独立培训交易源接口、签到授课、消费复核/异议、请假补课退款及原生入口。青少年正式招生与课包保持关闭，不伪造假赛事或真实支付。
允许路径：training-*源/测试、contracts/training、046迁移、training页面和utils/tests、此卡和同名交接。root负责共享API注册、trade源、双向共享日历与路由菜单；不改历史迁移。可本地commit，GitHub同步由root负责；禁止生产与真实外部资金/消息。

计划验证：定向domain/service单测，类型检查，原生页VM，真实PG集成测试编写后交隔离CI。当前尚未执行；046已开始编写、未执行。

2026-11-01 检查点 1：已实现 046 持久表/防篡改触发器、机构/教练独立审核、课程排课、库存与 FIFO 候补、冻结合同独立交易源、真实支付核对、签到授课与消费双复核、异议裁决、请假补课、逐课退款保留/独立审批/未知结果保留。HTTP controller 与 trade 源桥已编写。收费需 root 注入有效 merchant binding；免费报名不会生成假支付。已执行 API typecheck 通过、training-domain 单测 8/8。尚未执行真实 PG、端到端 UI；尚待 native 页面、真实 PG 测试及集成审查。Migration 046 仅已编写。
