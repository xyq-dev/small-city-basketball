# R6MATCH 交接

状态 IN_PROGRESS / LOCAL_ONLY。基线及允许范围见[任务](../tasks/R6MATCH.md)。2026-11-01（Asia/Shanghai）正在实现第一切片。

共享接线：MatchingSourceHooks.prepare在需求锁前获取原源日历/资源锁；返回execute闭包在同事务创建原业务单。缺真实hook明确拒绝转换，不模拟成功。页面注册及app.ts由root负责。

未执行真实PG、真机和生产；新044迁移未执行。后续继续实现SQL持久服务、控制器和UI。

切片1已可审查：MatchingService、MatchingController和044迁移，构造第三参`{enabled,sourceHooks}`默认关闭。API前缀`/v1/matching`，控制器共9条路由；读工作台/详情/回执，写授权/需求/匹配/意向/需求命令/意向命令。共享api.js白名单与app.json/UI菜单由root负责。单测14项及API typecheck通过，真实PG仍未执行。

实现边界：一个需求为一个角色×人数（最多16），成人球员可最多64个确定时段且同一席位同一人；工作人员及约赛一个时段。新订单为原流程初始REQUESTED/OPEN，意向不是占档。供给主动选择明确地区，现有公开档案不自动授权。候选未核验的交通与可靠性维度为null；总价未知必须先在原服务确认报价，跨城直接转换拒绝进入本地单。源锁→授权锁→需求→席位→意向；同事务hook失败整笔回滚。这里只持久站内事件，不接外部消息发送。

切片2接口补充：`MatchingConversionInput.candidate.settingsVersion?:number`，ADULT必须由snapshot写入；候选DTO `settingsVersion:number|null`，意向DTO含`candidate: MatchingCandidateData|null`供实际转单审条款；需求DTO `truncated:boolean`明确截断。PLAYER桥可校验用户审阅版本与候选冻结版本。PG测试文件r6-matching.integration.test.ts共10例，本地无PG未执行。原生UI及8例node测试已经写好并通过，将单独提交下一切片。

切片3 UI交付：`pages/matching/index.{js,json,wxml,wxss}`、`utils/matching.js`、`test/r6-matching.test.cjs`。页面依赖9条matching路由、现有trades/preview与local-bookings查询；C06转换sourceInput只显式资格/当前冻结settings版本/用户同意的收费条款。已有8项node native校验通过，不代表真机验收。需接app.json、ui.routes、expansion-api白名单和账号菜单；root已授权我后续在汇总分支同步入口，先等各新页面路径齐备。

补丁：候选24h时效在DB时间检查，过期不允许继续沿用原意向转单；12项PG用例覆盖三种供给类型（真实执行记录待root）。共享UI范围追加授权：app.json、ui.js、account/local入口、expansion-api、贸易源客户端标签/白名单及必要测试，维持既有5tab。恢复fixture由map agent统筹，我补matching九表快照检查。

共享UI接线已完成（root授权）：五新页注册、账户/同城入口、training/sponsor管理携带orgId、安全回跳、精确API白名单、资金来源类型/中文标签、contracts index四模块导出。依赖其它agent的training-paths.js与sponsor-commerce.js，应在root合并这些模块后cherry本提交。测试5个新入口用例、相关32项通过；本地组合所有新页面后全量wechat 1026通过/1 Windows跳过/0失败。源码页面依赖只临时复制做测试，未重复提交其它agent文件。保留原5tab与原订单财务流程。

恢复模块接口：`captureR6Matching(context)`使用`runtimePool/readPool/createLocalSource`，返回`{proof}`；helper返回`listingId/slotId/bookingId/provider.id/buyer.id/buyer.orgId/orgId/region/startsAt/endsAt/address`。`verifyR6Matching({readPool,saved,quarantined})`接受saved为capture返回值或proof；要求九表和canonical LOCAL_BOOKING/active reservation精确保留。quarantine期只允许规定的授权关闭、需求暂停、outbox取消变化（map负责ops SQL）。脚本是明确合成SQL恢复夹具，不声称源转换角色流程测试或真实收费；node syntax通过，真实重启/备份恢复待总集成。

2026-11-01复核修复交接：在`work/r6-matching-review`（f550ff2基线）修复TEAM场地快照、旧source command复用、付费STAFF/PLAYER缺账本降级以及X12逻辑过期。桥执行后强制读取同事务canonical trade_orders核验费用归属；缺商户503而非留下无资金单。普通旧C06/X12线下模式未变，严格门槛仅限新撮合转单。TEAM免费约赛不新造账本，既有球场确认资金门槛仍由X12执行。

待root运行：`r6-local-source.integration.test.ts`、`r6-matching-recovery.integration.test.ts`（新增6例）、`player-booking.integration.test.ts`匹配源用例。恢复覆盖三种source、多个PLAYER场次、UNKNOWN资金阻断且事实不改；STAFF/PLAYER真实TradeService同事务绑定，无外网支付调用。root需先保留自己的matching-player-recovery逻辑过期修复。本地已过20领域/桥单测、9原生匹配、API typecheck及定向格式；真实PG/真机未执行。测试中的合成商户/资料不代表真实服务配置。

仅提交显式owned路径；review worktree保留root三个贸易依赖修改及未跟踪PLAYER恢复副本/node_modules软链不提交。新的权限一致性审查：Matching TEAM认可org owner/admin，但旧X12约赛仅认可team grant；建议新TEAM资格跟随旧源，root待处理。本次复核关注由其他agent/root提供的源桥，不作为本人MatchingService唯一独立审查。

后续小片：修复CI149 APPROVED profile审核员fixture（R6MATCH与新recovery两处），使用maintainPlatformOperator登记合成有效审核员，未放宽DB约束。TEAM权限结论经root确认收窄到X12 team_access_grants：需求管理、供给、候选、workspace、桥对方重验统一；新增PG覆盖无授权机构owner被拒、显式grant后可用、撤销后立即失效。小程序显示球队授权前提。API typecheck、20单测、10native通过；新PG本地未运行。

整合单测修复：matching-local-source.test.ts的Actor与SQL fixture已匹配新生产桥读取，新增旧STAFF/TEAM回执拒绝和canonical账本缺失/不符边界；27项matching领域/源桥单测及API typecheck通过。只改测试和本任务记录，不回退生产校验。

恢复source升级：与map 2e8297e的createLocalSource(label,{paid:true})接口配套，matching必须取得真实tradeOrderId/termsId/totalFen；没有绑定立即失败。保留明确synthetic matching SQL定位，但来源为真实TradeService条款独立审核→原book+consent同事务资金绑定→provider接单。新增恢复proof核资金来源、双方、金额、商户条款、source_snapshot/source_hash/quote和零支付尝试，按现有E04隔离规则允许仅status/version变化。脚本语法/格式通过；PG恢复未本地执行，根集成时需同时保留map helper提交。

隔离恢复断言修复（2026-11-01 Asia/Shanghai）：root授权修正旧X12 quarantine与matching恢复检查冲突。普通重启/恢复现在严格比较九表完整行摘要、原预约完整行和全部reservation完整行；隔离只允许旧SQL规定的CONFIRMED→CANCELLED、固定原因、version+1、change/checkin清空及resource.active=false。来源其余列完整摘要、资金绑定、金额、席位/意向/assignment预算占用仍严格保留；所有updated_at精确等于RESTORE_QUARANTINE审计时间，不泛化忽略时间列。matching授权/需求/outbox及资金状态按具体变化精算。

验证：node语法、Prettier、git diff检查通过；临时mock SQL验证器接受普通/隔离两个正确状态，拒绝9种来源、资源、预算、资金或时间篡改。该检查只验证JS断言分支，不替代真实PG。真实archive恢复待root CI154；仅修改自有脚本与任务/交接记录，未改旧quarantine语义。

2026-11-01（Asia/Shanghai）共享退款收口追加授权：root委派trade-service/source-adapter/合同及对应测试、原生trade-order页；新worktree `/workspace/scratch/aad368826b09/scb-six-trade-retry`、分支`work/r6-trade-retry`、基线18c570a，开工clean，远端xyq-dev/small-city-basketball。ads持有重试链及四参数只读assertRefundRevocation事实hook，root持有wiring/ACL；dispatch协作者仅改本worktree的4个原生trade页/测试路径，不单独提交。特殊APPROVED退款REJECT沿common独立manager/operator及fresh session权限，限定广告恢复未发送且祖先已成功；APPROVE也在相同锁下复核来源。GET限广告确切退款过占给真实金额冲突视图，不放松任何写路径。进行中，验证待补。

共享退款收口实现完成：optional assertRefundRevocation仅供SPONSOR_ORDER未发APPROVED后继，实际状态fence/provider_refund_id/success_at必须全null，原immutablebinding的kind/source必须一致；沿用common独立manager/operator、排除付款/收款/提议人且提交前fresh session。APPROVE在PENDING阶段也复用source dispatch核验，源事实变化时整笔拒绝。原命令回放仍沿旧operation机制，不删除或重绑历史。root统一接ads只读hook，本片不改wiring。

GET每条退款返回canRejectApprovedRefund；仅广告退款过占且其它已结金额全部经原严格计算通过时，balanceConflict只读保留实付/已退/全部占用、可退0，写路径仍严格。原生页按退款ID独立确认撤回，身份/版本/刷新变化清空；冲突时禁资金执行和重试，仅保留原号查询与受控REJECT。协作者dispatch完成UI，training独立审查指出restore quarantine503会挡历史页，已仅将明确SPONSOR_RESTORE_QUARANTINED映射能力false，mutation仍拒且其它503/SQL不吞。

验证：全项目typecheck、38项定向(33新增+5资金领域)、17原生测试、完整API source 1335/1335及格式/diff检查通过。首次全source仅新unit“负金额”夹具未触发原计算器错误导致1项失败（1333项通过），改为确切非整数过占后最终全source全部通过，未放宽生产计算器。真实PG新增文件由dispatch协作补写中，本机无PG未执行；完整真实ADS retry链由ads模块PG另验。未生产、未远端写、无Migration修改。

共享退款PG追加（2026-11-01 Asia/Shanghai）：协作者dispatch在本worktree补`r6-trade-refund-revocation.integration.test.ts`，8个test声明/16个展开场景，真实migrated PG/auth/会话与原生sponsor source reader、真实captureSourceCharge/captureSourceRefund和immutable binding。签约、付款确认和迟到渠道事实明确为SQL合成fixture，domain资格hook为受控测试替身；真实ADS祖先/后继完整链由ADS专属PG另验，不能混称本文件是完整生产角色旅程。

覆盖PENDING APPROVE来源复核失败无mutation/无出网；过占GET保留1000实付+1000已退+2000占用并可安全拒绝未发送后继；旧版本拒绝、成功只增一次version且原command重放、原binding不可改删；付款人/收款人/提议人独立审核拒绝；7种状态/已发证据、3种绑定缺失或错配、hook缺失/事实拒绝/隔离关闭；事务末fresh失效全部回滚及真实已撤销session入口拒绝。全项目typecheck、单文件Prettier、git diff检查及Vitest用例收集通过，本机未执行PG。下一步root cherry本片并纳入CI156的R6真实PG早检，生产/外网/真实资金未触及。

PG夹具独立复核：map逐项比对030/038/047/048、source consent/商户/hash、角色与金额、session/version/replay后无确定SQL/API阻塞。本人另对root最新047与18c570a差异确认只新增retry关系及history规则，不改变本夹具旧source约束。该只读结论不替代真实PG执行。
