# 八项功能代码与验收对照

状态：业务源码与完整隔离验收通过，[PR34](https://github.com/xyq-dev/small-city-basketball/pull/34)已合入main，merge commit `9bfc54d12188846fa6a63605606dff89b783d025`。合并tree与下述已检候选精确相同；本文区分业务实现、隔离证据和正式外部接入。[当前状态](../CURRENT_STATUS.md)。

| 用户要求 | 已实现代码 | 页面与原有流程 | 尚未完成的正式外部验收 |
| --- | --- | --- | --- |
| 小程序直接开播、多平台分发 | [直播服务](../../apps/api/src/streaming-service.ts)、[采集合成执行器](../../apps/api/src/live-media-executor.ts)：批准、源租约、权威比分烧录、多目标转推、停播屏障及物理证据 | 单场比赛→直播工作台；频道、最长时长、费用上限、录制选择和独立批准 | 正式小程序推流准入、摄像头/麦克风及真机、腾讯和外站账号/同播权限、实际双目标及费用 |
| 整场录像、转码、自动集锦 | [媒体执行器](../../apps/api/src/live-media-executor.ts)及直播服务：录制/转码/基于有效得分与PTS校准的集锦、产物校验、来源链撤权 | 直播工作台→录像与媒体作业；授权下载及独立公开/撤回 | 实际长时整场采集、真实中断场景、正式媒体容量与独立MP4归档恢复 |
| 在线购买保险 | [保险服务](../../apps/api/src/insurance-service.ts)、[独立预审](../../apps/api/src/qualification-precheck-service.ts)：产品、报价、外部付款、出单、查原单、退保及不可变保单 | 本人资料及保险订单页；最终资料审核保留已有外部保单 | **实际保险供应商尚未选定，真实adapter尚未接入**，故购买编排默认关闭；不把合成provider当正式投保 |
| 真实交易资金闭环 | [交易服务](../../apps/api/src/trade-service.ts)、[微信支付驱动](../../apps/api/src/commerce/wechatpay.ts)、[JSAPI身份](../../apps/api/src/trade-payer.ts)：支付/退款/对账/独立扣减/分账/原分账回退 | 报名费、保证金、球场/人员/球员预约；创建同事务绑定、退款后冻结/履约持续复核 | 正式商户、AppID、分账关系、真实付款/退款/账单与原分账回退联调 |
| 微信消息通知 | [通知服务](../../apps/api/src/notification-service.ts)及[source](../../apps/api/src/notification-source.ts)：业务hook、一次性订阅、站内消息、持久队列、失败恢复和公平处理 | 我的消息/微信订阅提醒；开赛、改期、审核及关注事件 | 正式微信身份/模板、订阅授权和实际发送；客户端accept不等于送达，UNKNOWN不自动重复发送 |
| 全国统一搜索 | [统一搜索](../../apps/api/src/unified-search-service.ts)：赛事/球队/球员、地区/分类、当前公开来源、有界补扫与准确游标 | 首页顶部搜索；撤回来源、青年许可或主体状态后重新核权 | 无新增付费供应商依赖；正式微信/真机消费者仍另验 |
| 账号自助注销 | [注销服务](../../apps/api/src/account-closure-service.ts)、[六域hooks](../../apps/api/src/account-closure-hooks.ts)：重新认证、未决业务阻塞、延期/撤销、去标识与授权撤回 | 我的→账号自助注销；交易、保险、履约、停流与负责人责任须先处理 | 正式环境运行与运维演练；备份中缺失的后续注销事实不能凭数据库tombstone推断，旧备份必须隔离核对 |
| 青少年与监护人确认 | [监护服务](../../apps/api/src/youth-guardians-service.ts)、[成年再同意](../../apps/api/src/youth-adult-data-consent.ts)：数据预同意、独立确认/审核、按用途撤回、当前版本与并发保护 | 青年/监护页与赛事独立审核；C23、资格、报名冻结、照片、公开档案及直播持续复核 | 正式微信/真机及实际运营核验；业务监护年龄阈值不代表已满足所有地区法律要求 |

## 隔离证据

最终候选`120802fd2729db972020df5309100c25af11f545`的[CI7 41189029140](https://github.com/xyq-dev/small-city-basketball/actions/runs/41189029140)三个job均完整SUCCESS（attempt1），root已读三套原始日志：

| 层级 | 实际通过 |
| --- | --- |
| 源码、类型、格式与构建 | API1158、admin561、原生1008；1项既有Windows平台跳过 |
| 真实PostgreSQL | 584业务PG＋21最小权限PG |
| 原生页面到真实API | 21/21，包含真实时间履约和丢响应恢复 |
| 浏览器 | 1067兼容浏览器、1053布局PNG；桌面12＋移动12真实API浏览器，隔离HTTPS4 |
| 持久化与恢复 | 176表完整指纹重启、第二PG/卷完整备份恢复、业务快照/fencing/quarantine；新增49表全部有非空业务样本 |
| 清理隔离 | 正常及故障子进程只清理自有测试数据库/资源，独立control保留 |

API job124501785983、admin124501786098、production124501786278。测试merge-ref`10becc3a4eb4b58fe912c7572369225797a56bf6`完整tree`73f20bdfa65192382ce8e03112ac6f08ec9a3661`与候选精确相同。旧001—035未修改；前轮失败、真实修复及复验保留在[总任务](../tasks/EXPANSION8.md)。

当前68条原生路由、42项迁移、176表/117函数。001—042冻结，后续DDL从043追加；[冻结清单](../tasks/EXPANSION8_FROZEN_MIGRATIONS.json)记载首次成功执行证据。无生产部署、生产迁移、真实资金、真实投保、真实推流或发信。

数据库dump不包含MP4字节；本轮合成媒体字节检查不代替正式媒体卷归档。兼容浏览器以WXML/WXSS渲染并对原生组件明确占位，不能作为官方微信运行时、摄像头/麦克风、真机或外站验收。

操作见[使用指南](../EXPANSION8_USAGE.md)，配置和恢复边界见[运行说明](../EXPANSION8_OPERATIONS.md)。
