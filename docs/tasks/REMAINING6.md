# REMAINING6：六项功能实现

状态：REVIEW；integration：BRANCH_ONLY（隔离验收与最后修复进行中）；日期：2026-11-01 Asia/Shanghai。集成人：当前Codex root。任务来自用户“先开发这些”，业务依据DOC006六份专项。

## 核验与权限

工作目录 `/workspace/scratch/aad368826b09/scb-six`；分支 `feat/remaining-six`；远端 `https://github.com/xyq-dev/small-city-basketball.git`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，tree `99a5483bcd7c51032880deb0e24469b6546b1eda`。新独立checkout开始时clean，未改既有工作树。通过GitHub连接器补齐40个缺失blob，逐SHA核验并恢复exact commit/tree；本地仅保留浅层历史，GitHub同步由集成人按真实远端父提交进行。

允许本任务实现、定向和必要隔离测试、明确路径commit、普通分支同步、PR与审查通过后的整合；禁止生产部署/生产Migration/生产数据、真实资金/投保/消息、付费资源、新外部凭据及公网端口。沿用AGENTS已有Git与隔离CI授权。

## 所有权与依赖

| 子任务     | 独立分支/目录后缀                     | 独占模块与迁移                                                                          | 当前状态    |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ----------- |
| R6INS      | work/r6-insurance / scb-six-insurance | insurance代码与页面，043准入；真实供应商协议另为外部阻塞                                | IN_PROGRESS |
| R6MAP      | work/r6-map / scb-six-map             | local查询/DTO/原生地图页面；暂不新增迁移                                                | IN_PROGRESS |
| R6MATCH    | work/r6-matching / scb-six-matching   | matching新域/API/页面，044                                                              | IN_PROGRESS |
| R6DISPATCH | work/r6-dispatch / scb-six-dispatch   | dispatch新域/API/页面，045                                                              | IN_PROGRESS |
| R6TRAIN    | work/r6-training / scb-six-training   | training新域/API/页面，046                                                              | IN_PROGRESS |
| R6ADS      | work/r6-ads / scb-six-ads             | sponsor-commerce新域、多方driver/API/页面，047                                          | IN_PROGRESS |
| 集成       | feat/remaining-six / scb-six          | app装配、shared contracts索引、trade来源、共享日历048、源事务转换、菜单/恢复/注销及汇总 | IN_PROGRESS |

子任务只写自己的任务/交接，不写CURRENT_STATUS/TASKS。旧迁移001—042冻结；新增迁移在合并前统一检查连续性。LocalServicesService查询部分先由地图子任务负责，源事务提取由root串行接续，其他任务通过明确同事务hook集成，不绕过原业务。

## 验证与检查点

- 开工已执行API TypeScript检查：`npm run typecheck --workspace @small-city-basketball/api`，退出0。仅证明未修改基线可类型检查。
- 依赖复用同仓库现有安装，不升级锁文件。当前执行器未提供Docker/psql；真实PG与恢复测试拟由隔离CI执行，未运行前不得标通过。
- 计划依次执行每模块有效单测/原生VM、整合typecheck/format/build、真实PG鉴权/并发/资金/日历、页面真实HTTP与布局、迁移重启及恢复隔离。代码审查与当前HEAD证据通过后才整合。
- 保险真实供应商、正式商户能力、培训属地经营条件及微信真机属于外部验收，不能用合成驱动替代。未接能力保持关闭，保留可执行已有订单核对义务。

## 第一轮整合检查点

六模块首片及地图完整前端已提交；PLAYER原预约已提取同事务prepare/execute。主干尚未改变，真实PG尚未运行。

集成新增TRAINING_ENROLLMENT/SPONSOR_ORDER交易类型及强制来源adapter，训练合同ID与旧trade_terms外键分离；退款必须使用逐项分配、唯一绑定及派发前复核，广告禁止旧单收款方结算；dispatch冻结报价纳入原LOCAL_BOOKING源。048扩展四类档期双向互斥与过期释放，保留原占位历史。新模块默认关闭，恢复隔离强制关闭。

根定向trade-domain / trade-source-adapter / readiness共26项通过，migration静态检查48连续文件/220表/126函数通过；这是源码检查，非PG迁移成功。各模块具体证据见自身任务卡。菜单、所有生产source桥、广告多方接线、注销隐私、R6恢复覆盖和真实PG仍在整合。

下一步：补齐source与UI接线，开启当前分支隔离CI，修复真实PG/恢复/回归发现的问题，再独立审查。

## 第二轮整合与 CI149

PR #35 已创建为草稿。源事务、原生页面、注销及恢复清单已接线；培训和广告使用真实统一交易账本，付费撮合/派单不允许只占位而缺资金单。新功能严格开关及地图稳定游标签名配置见 `docs/operations/remaining-six-runtime.md`。

首轮隔离 CI149（remote head `68ed65c53e43333a02e5e9cf1bc0e180f4504e62`）：admin job 成功；48 个迁移在 PostgreSQL 成功；API 集成597 passed / 4 failed / 10 skipped，另1个suite setup失败。失败已定位为readiness不接受数字表名、撮合审批fixture缺平台审核员、地图/预约fixture缺版本推进、培训独立审核fixture权限预期。后续片正在修复并扩展共享日历及资金恢复测试。生产包隔离job因同一readiness问题失败，尚未完成当前HEAD备份恢复及整套验收，不能据旧片测试标记当前整套通过。

当前本地已通过新readiness/runtime/source adapter定向25项和API类型检查；广告退款解冻、财务追偿、跨域日历新增证据继续纳入下一轮。真实保险外部驱动仍BLOCKED；不部署、不调用真实保险/资金/消息。

当前CI152的新域PG完整通过；严格运行角色回执行锁问题已修，不扩大append-only权限。普通广告主入口与广告运行配置已接线；补课选择器及学员真实HTTP验收已补，等待当前HEAD隔离验证。主干并发UI001文档已从911564f0逐blob哈希核验保留，不覆盖设计交付。当前独立审查未发现尚未修复确定P1，最终完整CI/恢复仍待执行。

2026-11-01 11:35 Asia/Shanghai检查点：remote c0a4cc8以真实双parent整合main 911564f，tree54751ecc与本地d47a579一致，PR35已ready但未合并。CI153新域真实PG通过；admin源码检查全部过，布局1079过/3失败均培训输入字体<16px已修；production受限角色21PG过，恢复培训冻结时间UPDATE失败，改真实DB+60s短课不扩ACL。自动审查4项正以真实PG/原生生命周期补证；当前仍REVIEW/BRANCH_ONLY。无生产或外部真实渠道操作。

2026-11-01 11:40 Asia/Shanghai候选检查点：PR35四条审查修复均已集成（未付取消注销、两培训页隐藏写锁、跨班补课取消、独立有界派单轮询），派单仅增加next_source_check_at列UPDATE。CI153新域78项PG过，旧域585过/1个公共列表分页fixture失败，现用真实唯一标题查询保持全部隐私断言。恢复修正保留真实冻结课次、精确X12隔离取消/资源释放与广告canonical身份hash；完整typecheck、定向28、原生培训13和恢复12过。待CI154验证当前完整候选，尚未合并。
