# R6MAP接续

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](../tasks/REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01 Asia/Shanghai。当前IN_PROGRESS/LOCAL_ONLY；上下文、范围与计划见[任务卡](../tasks/R6MAP.md)。

首个切片：后端视野合同、签名分页、真实矩形SQL与no-store完成，API typecheck及领域11项测试通过。新增 `apps/api/test/r6-map.integration.test.ts` 四项真实PG测试，未在本地执行，需root/CI隔离库运行。下一步完成原生地图主动搜索、跨城确认、视野代次隔离与页面测试。

组合根接线：`LocalServicesService`第六参数可选 `{cursorKey: Buffer(32), enabled: boolean, maxSpanMeters: number}`。推荐专用签名配置注入以支持多实例；缺省为进程临时32字节key（重启或跨实例旧游标拒绝并要求重读），功能默认开启，边长上限默认100000米，可配置1000–100000。无需新业务表或索引迁移；性能目标尚未压测。不触及预约事务；root可串行集成预约重构。

只有显式 `searchVersion:2` 且带 `viewport` 才增加顶层 `searchArea`；能力放已有 `locationCapability.viewportSearch`。视野模式不依赖外部地图解析商开关。没有Migration、生产或外部服务操作。

第二切片：原生地图与仓库读取器接线完成。视野/上下文独立代次，getRegion/getScale超时和迟到响应拒绝；显式搜索/临时跨城/恢复/城市列表降级；分页不移镜，已提交范围标签和同一列表标记同步。旧能力响应自动禁用新请求。精确范围只存在页面内存/POST体，离开清除，无URL/持久缓存写入。新增7项实际Page+utils VM测试；定向27/27，微信全量1015通过、1个既有Windows测试跳过。格式通过。

余项：root/CI执行真实PG4项；真实微信基础库regionchange/getRegion/getScale、触控布局和iOS/Android实测；合成10万库存性能评估。未申请或使用地图生产配置，未宣称真机/性能/PG已验收。前端没有更改原预约请求或费用计算。

root追加来源桥：`prepareBookingInTransaction(c,actor,raw)`与`prepareMatchupInTransaction(c,actor,raw)`先锁org/calendar/source/receipt，再返回execute；无HTTP或嵌套transaction。`createDispatchBookingInTransaction`固定方法供dispatch注入，要求caller已在同事务释放dispatch reservation，持久hold仍ACTIVE、offer仍ACCEPTED_HELD；重读冻结报价、需求、持有人、merchant/terms和保护区间，再真实创建源预约。snapshot.dispatchQuote结构为 `{...offer.quote,offerId,quoteHash}`。root trade需识别此快照并与持久offer交叉核验及接收quoteHash收费同意。

`createMatchingLocalSourceHooks(local)`导出STAFF/TEAM prepare与inspectEnded；实际对象/档期/地址来自need/candidate，sourceInput仅允许同意或明确球场预约/条款。终态财务检查保守：任何未决操作，或净实付/批准扣款/已结算净额不一致均禁止重开。新增领域5项通过；新增真实PG4项未执行。需要根合入其他模块类型 `matching-source-adapter.ts`、`contracts/matching.d.ts`及实际 `dispatch-service.ts`；本worktree只放临时类型依赖用于typecheck，未提交这些由其他agent拥有的文件。

来源桥回执兼容复核：约赛prepare只锁原供给行，不在旧回执返回前重新要求发布/人员当前可用；新建execute仍执行原实际球场资格校验。避免资格后来变化导致已成功约赛回执无法重放。

派单复核补丁：源预约待接单截止同时受冻结报价protectedStartsAt约束，防止出发准备已过后仍利用普通10分钟窗口接单；普通同城预约截止不变。由dispatch实施者只读审查指出并修正。

CI149回归：root报告地图PG撤销发布fixture触发版本保护，因为直接UPDATE未递增version。最小修复仅将该测试撤销语句补 `version=version+1`，保持实际业务触发器约束；不放宽迁移或生产校验。真实PG重跑待root CI。

追加有偿派单验证（2026-11-01 Asia/Shanghai）：`work/r6-paid-dispatch`基线19cb239，新增 `dispatch-source-adapter.test.ts` 9项已通过；API typecheck通过。`r6-paid-dispatch.integration.test.ts`两项使用真实供给审批、收费条款独立审核、DispatchService、LocalServicesService、TradeService和root默认收费桥。缺收费桥时要求503并逐行比较原请求/报价/hold/reservation/历史无变化；补齐后原commandId重试产生唯一完整1300分订单。第二项在同事务真实订单生成后抛错，检验已观察到的订单、原预约、资源占用、历史和回执消失且原hold恢复。没有外部收款调用，本地无PG未运行该两项；需root隔离CI执行，不得以单测代称真实事务已验。独立只读审查结论为未发现确定缺陷，真实默认app接线、错误传播与quote锁链已核对。

CI153字体修复交接：`work/r6-training-font`只追加training-manage表单控件16px覆盖，导入的26rpx不再使窄屏理由textarea缩小，管理页其他输入也遵守同一字号。既有r6-training native10/10通过；本地Playwright默认/override Chromium均不存在，320/390/430布局待CI重跑 `mini-program.spec.ts --project=desktop --grep initial-training-manage`。此小片不修改培训负责人JS、service或R6TRAIN记录。

CI153旧X12隐私测试小片：x12-local.integration.test.ts的supply返回唯一title，首个公开字段测试用q定位该样本，不再假设全县第一页面必含随机UUID新样本。问题来自R6先运行后保留同县多页库存；closeHarness不删除业务事实。全部原敏感字段/资格公开限制断言保留，额外要求唯一结果。生产代码、分页上限、原排序不变；PG交CI，未本地执行。

CI154 picker修复：training-manage/index.wxss仅把picker的27rpx换16px。实际模板三宽度CSS读取确认picker/内部文字/textarea全16px，已同时核对初始页两控件的行高、padding/高度声明；native10/10通过。此为静态DOM/CSS证据，非浏览器几何测量；请CI复跑原initial-training-manage三宽度门槛。隔离CI完整恢复结果由root记录，本片不更改恢复或权限。
