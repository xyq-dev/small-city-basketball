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
