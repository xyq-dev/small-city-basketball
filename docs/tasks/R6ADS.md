# R6ADS 广告合同与多方结算

状态：IN_PROGRESS；integration：LOCAL_ONLY。2026-11-01 Asia/Shanghai。

负责人：/root/implement_ads；集成人：root。目录 `/workspace/scratch/aad368826b09/scb-six-ads`；分支 `work/r6-ads`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，开工工作区clean。远端为本项目GitHub，真实快照由root核验导入。

范围：独立广告商业合同/订单/交付/结算/回退追偿PG模块、新多接收方微信driver、小程序入口与定向测试；只写分配的`sponsor-commerce-*`、`trade-wechat-multi-*`、合同、047迁移和本任务文档。root负责统一trade新来源、app、菜单、恢复及共享文档接线。

权限：本地开发、定向测试和本任务commit；远端同步由root执行。不部署，不执行生产迁移，不真实收款/分账，不配置新凭据。001—042不改。

验证计划：分配/退款单调性、严格请求和响应、组织/受益权限、独立审批、UNKNOWN原单查询、同源金额上限与PG并发；真实PG测试待隔离CI，商户实款联调未执行。默认新收款和结算关闭。

检查点：已核对既有trade与赞助实现；现有单接收方driver不可循环用于多人分账，新来源必须统一纳入trade。
