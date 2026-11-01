# REMAINING6：六项功能实现

状态：DONE；integration：MAIN（源码与约定隔离验收；真实保险adapter仍BLOCKED_EXTERNAL）；日期：2026-11-01 Asia/Shanghai。集成人：当前Codex root。任务来自用户“先开发这些”，业务依据DOC006六份专项。

## 最终整合与验收边界

2026-11-01 14:08 Asia/Shanghai（核验时间 `2026-11-01T06:08:12Z`），[PR #35](https://github.com/xyq-dev/small-city-basketball/pull/35) 已合入main，代码合并SHA `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree `e38a40da165a92f1eddc5696dcd41e7dc0e2a55a` 与CI160测试候选 `7a3f958c0440eca67d1d67e372a6e2d4c9d92440` 精确一致；双亲为 `911564f0` 和该测试候选。12条外部审查全部已解决，无新增线程。

[CI160](https://github.com/xyq-dev/small-city-basketball/actions/runs/41277450597) 三个作业完整SUCCESS，root已读取全部原始日志：新域真实PG143（含培训19）、旧业务PG586、原生页面→真实HTTP21、真实API浏览器24（12+12）；admin561、API源码单测1339、原生1076通过，1项既有Windows跳过；布局1082通过，1068项按配置跳过。runtime PG21、HTTPS4、221表精确重启与完整归档恢复、业务快照/fencing、quarantine及旧私有/公开/overlay凭证失效均通过；仅清理自有资源，control卷保留。

当前73条原生路由、48项Migration、221表（新增45表）、126函数。地图视野搜索、三类撮合、跨城派单、成人短课培训及商业广告分成的源码和约定隔离验收为DONE / MAIN；保险准入与接口框架也已整合，真实供应商adapter因协议、产品、证书和凭据未提供仍为 `BLOCKED_EXTERNAL`。001—042冻结，043—048仅在隔离CI执行；未更新生产，未进行真实投保、资金、消息或正式外部渠道操作。 青少年培训T2、课包T3、真实商户分账能力及正式微信/真机仍按专项门槛开放；垫付缺可信资金保留接口时保持禁用。

历史检查点保留每轮失败和修复：CI156的126通过/4失败后只修夹具，未放宽权限或资金核验；培训COMPLETE、全退款转入资金核对、受控RESUME和撮合培训档期过滤均已由最终CI160验证。源码框架完成不等于真实供应商接口接通或生产上线。统一证据见[验收映射](../audits/REMAINING6_ACCEPTANCE.md)。

## 开工核验与权限

工作目录 `/workspace/scratch/aad368826b09/scb-six`；分支 `feat/remaining-six`；远端 `https://github.com/xyq-dev/small-city-basketball.git`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，tree `99a5483bcd7c51032880deb0e24469b6546b1eda`。新独立checkout开始时clean，未改既有工作树。通过GitHub连接器补齐40个缺失blob，逐SHA核验并恢复exact commit/tree；本地仅保留浅层历史，GitHub同步由集成人按真实远端父提交进行。

允许本任务实现、定向和必要隔离测试、明确路径commit、普通分支同步、PR与审查通过后的整合；禁止生产部署/生产Migration/生产数据、真实资金/投保/消息、付费资源、新外部凭据及公网端口。沿用AGENTS已有Git与隔离CI授权。

## 所有权与依赖

| 子任务     | 独立分支/目录后缀                     | 独占模块与迁移                                                                          | 当前状态             |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| R6INS      | work/r6-insurance / scb-six-insurance | insurance代码与页面，043准入；真实供应商仍 BLOCKED_EXTERNAL                             | DONE / MAIN |
| R6MAP      | work/r6-map / scb-six-map             | local查询/DTO/原生地图页面；不新增专属迁移                                                | DONE / MAIN |
| R6MATCH    | work/r6-matching / scb-six-matching   | matching新域/API/页面，044                                                              | DONE / MAIN |
| R6DISPATCH | work/r6-dispatch / scb-six-dispatch   | dispatch新域/API/页面，045                                                              | DONE / MAIN |
| R6TRAIN    | work/r6-training / scb-six-training   | training新域/API/页面，046                                                              | DONE / MAIN |
| R6ADS      | work/r6-ads / scb-six-ads             | sponsor-commerce新域、多方driver/API/页面，047                                          | DONE / MAIN |
| 集成       | feat/remaining-six / scb-six          | app装配、shared contracts索引、trade来源、共享日历048、源事务转换、菜单/恢复/注销及汇总 | DONE / MAIN |

开发期子任务只写自己的任务/交接，不写 CURRENT_STATUS/TASKS；最终文档由 root 明确委派的文档 worktree 汇总，仍由 root 整合。旧迁移001—042冻结；新增迁移在合并前统一检查连续性。LocalServicesService查询部分先由地图子任务负责，源事务提取由root串行接续，其他任务通过明确同事务hook集成，不绕过原业务。

## 历史验证与检查点

以下保留各候选当时的失败、修复和待办；其中“当前”“下一步”“尚未执行”均以该检查点为准，不覆盖页首的最新候选状态。

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

2026-11-01 11:51 Asia/Shanghai：CI154（remote bf92e7139758eadf51fd748319670b881533a48b / tree cdb837c6d92991c4a9f5f3b5b3a606416bb5a683）新域真实PG步骤通过，四条PR审查已验证并resolve；隔离production job完整成功，含21项runtime PG、4项HTTPS浏览器、完整归档恢复及quarantine。admin源码检查过，布局1081通过/仅320px机构picker字体不足1失败；改统一16px，定向原生13过，下一轮CI155只新增该WXSS与文档，尚未合并。

2026-11-01 12:18 Asia/Shanghai：CI155 remote b1d9d316在页面/隔离运行包作业成功，API已通过90项R6、旧业务PG、原生API与重启，正在浏览器端到端。最新PR自动审查又报5个P2：未付广告闭账、0分分成终态、替代批次明细、确定失败退款恢复、派单漏培训档期。前三及SIGNED未建单关闭已集成，退款恢复采用保留原plan/return/binding的独立审核retry记录（新表尚在实施），privacy与派单并行修复。不因旧候选绿而合并已知问题，继续REVIEW/BRANCH_ONLY。

2026-11-01 12:35 Asia/Shanghai root整合检查点：已接入广告安全撤回source hook；当前全量typecheck/format、admin561、API1339、原生1070通过（1Windows专属跳过），新旧恢复/打包12项通过。CI155旧候选全绿（R6 PG90、旧PG586、原生API21、浏览器24、布局1082、runtime21和TLS4及完整恢复）。新5条审查修复现含退款恢复表、精算注销、派单培训冲突和共享审批/只读冲突视图；核心新增PG追加片在最后核对，完整新候选将进入CI156，未提前resolve或合并。

2026-11-01 Asia/Shanghai 文档草稿接续：root将 `scb-six-final-docs` / `work/r6-final-docs` 的33份未提交文档写权由training转给implement_insurance。实际基线9308f0de555a453b2bb7e364fbce52d5ee9ba880，原33份dirty全部保留；已核验远端为xyq-dev/small-city-basketball。按root要求暂不提交，先记录旧9审查已解决、新2 P2修复中、CI157仍运行且非最终合并候选；后续收到training/matching业务提交时保留其新增历史，待root最终CI/head/main事实后填写结论。未改任何业务代码。

2026-11-01 13:05 Asia/Shanghai root检查点：CI156新域126/130通过，4个失败为旧关闭样本缺真实canonical identity/hash及签约关闭fixture把隐藏404误期望403；只修测试，未放宽业务保护。CI157（remote5b3dfd05197186ee69a205164d5059e063b4719b/tree1078be9c7d5a8cd41e97c674ebd78f17efd88bfb，run41274334045）新域130及旧业务PG步骤通过，admin561/API1339/原生1070与布局1082通过；production21受限PG、HTTPS4、221表完整归档恢复/隔离成功，API原生联调及后续尚在跑。原9条PR审查已resolve，另2条P2为培训cohort正常COMPLETED路径缺失和matching遗漏training预留；撮合11行修复+5展开PG已整合local6263890，27单测/typecheck及独立审查通过，新PG未执行。培训正常结课、跨班权益/争议重开、安全到期未付候补仍在独立工作树补验，待一起进入新候选CI。main未变，无生产或真实渠道动作。

2026-11-01 Asia/Shanghai 后续独立复核检查点：CI158（run41276038120，remote bd4d0ed8 / local4da3060）新域140项步骤已执行，结果待root核验。又发现培训全退款CANCELLED转入例外漏查其UNKNOWN分账/回退，training补最小fullMoneyScope及负例，普通非取消转入不扩查别班未来范围；CI158因此仅作验证基线，最终候选待新修片及必要复验。PR35仍未合main，不改变已记录的9条已解决/2条待验审查事实。文档33份dirty继续保留，尚未提交。

2026-11-01 Asia/Shanghai CI159候选检查点：root已同步 local681fa2d3 / remoteaaaf13661b5c592ddddd943548d0c231fe15ede0，treeacebcbdba81e1c4bb9da75f75c9c96c580e59ff1；培训follow-up原eb77023的R6TRAIN任务/交接6行历史已保留。CI158新域140项步骤成功，matching审查XXZC已resolve；共11条审查10条已解决，仅cohort XXZB待本候选PG。全退转入fullMoneyScope及2种UNKNOWN资金矩阵已通过APItype/format/domain8/独立审查，真实PG和完整CI159待执行，不提前记MAIN或通过。33份文档仍未提交。

2026-11-01 13:33 Asia/Shanghai root检查点：CI159（aaaf13661b5c592ddddd943548d0c231fe15ede0/treeacebcbdba81e1c4bb9da75f75c9c96c580e59ff1，run41276560195）新增域140项PG步骤通过，含全退转入来源的未知分账/回退负例；admin561/API1339/原生1073与布局1082通过，production受限PG21、HTTPS4及221表完整恢复/隔离通过。撮合与培训结课线程已resolve；最新第12条审查为SUSPEND后缺恢复，现整合local7f0d5c2：RESUME复核当前资格、原/转入未决消费及原资源证明，deadline前ENROLLING/后RUNNING，不重造资金/资源；DRAFT不可暂停绕发布。新增3个PG（training16→19，总新域预计143）未执行；原生19、独立审查及root全量type/format/build/admin561/API1339/原生1076通过（1Windows跳过）。待新候选CI全部成功与最后线程验证后合并，main仍911564f0，无生产或真实渠道操作。

2026-11-01 Asia/Shanghai CI160阶段检查点：候选 localfe91ed044011aacf148b5ee51045d56cdf9cccef / remote7a3f958c0440eca67d1d67e372a6e2d4c9d92440，treee38a40da165a92f1eddc5696dcd41e7dc0e2a55a；run41277450597，API job124762542680 的 step11新增领域PG已completed/SUCCESS，包含受控RESUME新增3项。培训19及总143为计划计数，须待API作业完整原始日志核验后填写actual；此时已进入旧业务PG，admin布局及production恢复仍在运行。PR35共12条外部审查全部resolve；源码稳定，无新增代码计划。最终待核包括所有job结论、各测试实际计数、归档恢复/隔离与清理、最终候选及merge SHA/tree；在root给出证据前不标全CI成功或MAIN，33份文档继续不提交。

2026-11-01 Asia/Shanghai CI160双作业核验检查点：CI160 admin（job124762542860）与production（job124762542902）均已SUCCESS，root已读取完整原始日志：admin561、API源码单测1339、原生1076通过（1项既有Windows跳过），布局1082通过（1068项按配置跳过）；runtime PG21、HTTPS4、221表精确完整归档恢复、业务快照/fencing与quarantine均通过，旧私有/公开/overlay凭证失效；仅清理自有资源且保留control卷。API job124762542680仍在旧业务PG阶段，新增域精确计数、旧业务PG、原生HTTP、真实API浏览器及重启结果尚待该作业原始日志核验。 12条review全部resolved且未出现新线程，最终状态仍REVIEW/BRANCH_ONLY；等待API完整结论及merge SHA，33份文档未提交。

2026-11-01 Asia/Shanghai CI160旧业务PG阶段检查点：API job124762542680的步骤12旧业务PostgreSQL检查已completed/SUCCESS，正在step13 Native mini program pages against real API。此处仅记录步骤成功，不在原始日志归档前推定测试计数；后续原生HTTP、capture/restart、真实API浏览器及cleanup仍待完成。admin/production成功和12条review全部resolved不变，main仍911564f0；未记整套CI成功，33份final-docs保持dirty未提交。

## 2026-11-01 14:08 Asia/Shanghai 最终验收与文档收口

2026-11-01 14:08 Asia/Shanghai（核验时间 `2026-11-01T06:08:12Z`），[PR #35](https://github.com/xyq-dev/small-city-basketball/pull/35) 已合入main，代码合并SHA `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree `e38a40da165a92f1eddc5696dcd41e7dc0e2a55a` 与CI160测试候选 `7a3f958c0440eca67d1d67e372a6e2d4c9d92440` 精确一致；双亲为 `911564f0` 和该测试候选。12条外部审查全部已解决，无新增线程。

[CI160](https://github.com/xyq-dev/small-city-basketball/actions/runs/41277450597) 三个作业完整SUCCESS，root已读取全部原始日志：新域真实PG143（含培训19）、旧业务PG586、原生页面→真实HTTP21、真实API浏览器24（12+12）；admin561、API源码单测1339、原生1076通过，1项既有Windows跳过；布局1082通过，1068项按配置跳过。runtime PG21、HTTPS4、221表精确重启与完整归档恢复、业务快照/fencing、quarantine及旧私有/公开/overlay凭证失效均通过；仅清理自有资源，control卷保留。

当前73条原生路由、48项Migration、221表（新增45表）、126函数。地图视野搜索、三类撮合、跨城派单、成人短课培训及商业广告分成的源码和约定隔离验收为DONE / MAIN；保险准入与接口框架也已整合，真实供应商adapter因协议、产品、证书和凭据未提供仍为 `BLOCKED_EXTERNAL`。001—042冻结，043—048仅在隔离CI执行；未更新生产，未进行真实投保、资金、消息或正式外部渠道操作。

文档owner implement_insurance 在 `scb-six-final-docs` / `work/r6-final-docs` 保留原33份草稿及所有后来追加的 R6MATCH/R6TRAIN/root 检查点，统一当前banner、设计契约和验收矩阵。此次收口只修改这33份Markdown，以以上main代码合并SHA为基线，不自引用后续文档提交SHA；未重跑已通过应用CI，后续纯文档同步由root按最新main执行CAS。旧失败及阶段待验记录保留，UI001200帧不冒充全部像素实现，真实保险adapter仍外部BLOCKED。

本次文档验证：33个变更路径全部为Markdown；14份跨提交追加历史逐字保留，300个相对链接目标均存在，31个表格列数一致且代码围栏闭合，git diff --check通过。项目format:check不包含Markdown；本次只执行与文档变更相符的链接/结构/空白检查，不重写历史段落格式或重跑应用测试。
