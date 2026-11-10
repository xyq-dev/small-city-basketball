# MEMBER02 · 真实机构月/年会员接续

2026-11-10 Asia/Shanghai；root；IN_PROGRESS / LOCAL_ONLY。

基线ac6f700，root独立工作树scb-membership、分支feat/MEMBER02-integration；源仓库与边界见任务卡。本轮继续完整机构购买期/跨届额度/续费/退款核心与响应式Web，复用原支付，不操作生产。后端先冻结模型/契约与锁序并独立审查；实际代码与测试未发生不填通过。原生小程序仅Figma，不属于本卡首批代码。


## 2026-11-10 16:10 Asia/Shanghai 可接续点

root树当前e54b566及未提交接线/恢复/CI工作，作者各自worktree开发中。合同远端检查点e0de988只含已审合同/任务，不含应用实现。共享root允许路径增加RuntimeApp.tsx、原ScheduleEditor发布确认/既有流程测试、恢复/打包/隔离runner与新config/test。root纯恢复与打包6项通过，新应用完整类型/构建未执行（作者尚未整合），不得沿用MEMBER01旧结果；尚无052执行或PG通过。后端锁序设计已审，代码仍待独立复审。

接续先查三作者现有提交与未提交，不覆盖：core scb-member02-core、Web scb-member02-web、root scb-membership。core负责原commerce/app数据；root只持接线/manifest/恢复/CI，避免同写。root已明确真实会员首批Web+手机响应式，小程序原生仍设计，禁止借球队memberships改成VIP。


## 2026-11-10 16:17 Asia/Shanghai 核心首批已整合、审查修复中

root已整合core a08750f→e156e3f、SQL括号修复5aba1a9→4fabb62、撤销reason NULL约束6096470→9f70b87。052新增1个period表、两个trigger函数，已补真实最小runtime manifest（SELECT/INSERT，UPDATE仅revoked_at/revoke_reason；trigger EXECUTE[]）、app.ts同CommerceService controller接线、readiness完整52期望及新表/函数断言。root API类型/构建通过；实际完整API源码126文件1452项通过，不是PG验收。原先51计数/缺manifest两失败已按新增实际schema修正，没有放宽集合/权限比较。

独立高风险审查仍进行中：已发现并修真实SQL括号P1与NULL审计reason P2；仍有会员付款精度/人工确认跨到期窗口P2交唯一core作者修复，未批准新候选。052仅编写，未在本机或生产执行；作者独立真实PG文件和合成回调仍在写。root Web路由/发布确认提示、恢复driver/打包/新ENFORCED浏览器suite在本地未提交，依赖Web作者整合后才完整类型/构建。不要误报完整可用。
