# R6MATCH 全国撮合实施

2026-11-01（Asia/Shanghai）；状态 IN_PROGRESS；integration LOCAL_ONLY。

负责人 `/root/implement_matching`；目录 `/workspace/scratch/aad368826b09/scb-six-matching`；分支 `work/r6-matching`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，开工工作区干净。远端由root统一同步。

范围：持久化需求、显式供给许可、三类候选、规则排序、双方意向、席位/预算并发、同事务源转换、原生页面及测试。允许新增 matching-* 源码/合同、044迁移、定向测试和本卡交接；共享App装配、源订单事务提取由root负责。无生产操作、真实收费或通知。

当前第一切片：候选合同、严格输入和排序领域；源转换使用prepare/execute两阶段接口，同一PG事务且先旧源锁后撮合行锁。现有公开档案不会自动获得联系许可。

计划：领域单测、API严格类型；真实PG集成测试将编写并由root隔离CI执行，本地无PG，不标通过。迁移仅编写未执行。

切片1（2026-11-01）：已新增044的九张PG表、独立供给发现/联系许可、三源资格读取、显式需求与席位、100候选上限及有种子的证据分档、发送/接受/撤回/转预约、总预算与同人去重、原单终态与金额检查后重开、幂等回执、恢复隔离门禁和Nest控制器。源转换使用root接入的同事务hook；没有hook时不允许转单。

本地验证：API typecheck通过；matching-domain.test.ts 14/14通过。尚未执行044迁移/真实PG；下一切片补真实PG集成覆盖与小程序页面。跨城候选可发现和互相表达意向，直接本地转单拒绝，待接跨城差旅流程。未知报价不伪装成免费；MEDIC未进入自动撮合。

切片2：补充10项真实PG集成测试（已编写、未本地执行），覆盖授权撤销、过期、幂等冲突、跨租户、同席位并发、同人多席位、源金额不符原子回滚、带保留费用重开、跨城阻断及暂停恢复；fixture转换钩子真实写入C06订单以验证调用事务，不替代生产源桥测试。修正C06日历列为player_user_id；候选加入settingsVersion并传入PLAYER源桥；每条意向附带经当前授权检查的候选资料，隐藏过时快照；候选上限truncated显式返回。API typecheck再次通过。

切片3：原生页面`pages/matching/index`及utils/matching仓库已完成：真实工作台/需求发布、多场时段与范围、供给按资料独立授权、候选及证据缺口、指定席位发意向、受邀接受/婉拒、双方意向后读取原收费preview、C06版本绑定、工作人员原预约、已确认同档球场转球队约赛、暂停/恢复/关闭/安全重开。没有装饰按钮或本地成功假数据。未知写结果按身份保存原commandId并查询/重试；换账号与离页阻断过时回包。

验证：native node定向8/8通过（严格DTO、分币及北京时间、actor隔离pending、报价变化拒绝、WXML处理器齐全、首屏无定位/无自动许可、离页/换账号隔离、网络未知同编号恢复）。未跑真机/截图，不标真机通过。共享路由/白名单尚待root分配接线。

切片4：候选快照24小时后禁止新意向或转单，详情隐藏过期快照。补工作人员有效资质/精确slot/未知报价到有效收费以及球队授权/免费证据两个PG用例（总12例，仍待隔离PG运行）；API typecheck、领域14项通过。开始root追加授权的五个新页面共享入口/白名单及贸易源标签接线，另协助匹配九表恢复演练fixture。

共享接线切片（root追加授权）：注册matching/dispatch/training/training-manage/sponsor-commerce五页与安全登录回跳；同城/个人/机构入口接真实页面；扩展API白名单按准确路径与动词校验（拒绝任意查询/越界路径），复用training、sponsorCommerce的独立path helper；统一资金来源支持TRAINING_ENROLLMENT与SPONSOR_ORDER并显示中文来源标签；导出四模块合同。未改变既有5tab。

验证：32项相关native/贸易/入口测试通过；在本地合入其它agent页面作为测试依赖后完整`npm run test:wechat` 1026通过、1个Windows专用跳过、0失败。第一次全量因尚未复制ads客户端依赖失败，补齐依赖后通过。复制的其它agent产物不放进本commit，root须先集成对应模块提交。API typecheck通过。仍未真机验证。

恢复切片：新增`scripts/r6-recovery-matching.mjs`，capture通过map统筹提供的createLocalSource真实创建/确认X12工作人员预约，再以runtimePool明确写入九表的合成恢复关系（不是生产角色旅程证据）；保存SQL摘要不输出私密原文。verify核对九表非空、来源订单与资源锁、席位代次和预算占用完整性；隔离后要求供给发现/联系关闭且version+1、ACTIVE需求暂停/version+1/清空当前run指针、PENDING事件CANCELLED，其余快照/意向/分配/回执保留。node --check通过，真实restore及ACL运行待root CI。

复核修复切片（2026-11-01 Asia/Shanghai）：root追加独立源桥复核及修复授权；新隔离worktree `/workspace/scratch/aad368826b09/scb-six-matching-review`、分支 `work/r6-matching-review`，基线 `f550ff262b42e5b0bd33678fa634dca2fca64e19`、origin仍为xyq-dev/small-city-basketball。允许临时修改matching-local-source、LocalServicesService恢复入口、matching-player-source及相关测试；不改原迁移或生产。PLAYER恢复实现由root持有，本切片仅增加其PG专项测试。

修复四类已确认P1：TEAM转单须冻结实际已确认球场的catalog/region/address；STAFF/TEAM不能复用已有原业务command回执重新绑定需求；STAFF及PLAYER转单须在同一事务存在主体、金额、条款一致的canonical trade_order，收费未准备好返回503并整笔回滚；X12恢复按锁下数据库时钟识别逻辑过期并释放过期日历占用，不改源状态或UNKNOWN资金事实。页面关闭付费转单时的线下降级提示并阻止提交。

验证：PLAYER源桥单测6项与匹配领域14项通过；原生匹配9项通过；API typecheck和定向Prettier通过。新增6项三型恢复PG测试，并扩充本地源与PLAYER既有PG测试验证真实TradeService绑定、无商户回滚、源回执拒绝重绑、场地不一致拒绝；支付transport为合成spy且要求未调用。本地无PG，所有新PG用例未执行，待root隔离CI。独立fixture复核发现C06 expires_at必须大于updated_at，已使用明确合成历史updated_at修正，无禁用约束。

本地typecheck依赖root未提交的matching-player-recovery、remaining-six-trade、trade-source-adapter、sponsor-commerce-source副本，仅作为集成依赖，不纳入本切片commit。另已向root报告TEAM机构管理员与原X12仅team_access_grants权限不一致，等待统一决定，不默默扩大旧源权限。

CI149跟进（2026-11-01 Asia/Shanghai）：root报告R6MATCH beforeAll的APPROVED booking_profile夹具违反有效平台审核员约束，整组用例未运行。已通过既有离线维护helper明确登记合成审核员，保持真实约束；新增恢复测试相同夹具一并修正。root采纳权限修复：仅TEAM的需求发布/管理、供给许可、候选重验、工作台及源桥对方授权收窄到有效team_access_grants；不扩大X12旧权限，不改变ADULT/STAFF服务端机构权限。页面说明机构所有者/管理员仍需球队管理授权。增加授权缺失、赋权、撤权后候选/接受/管理阻断PG用例；20单测、10原生测试、API typecheck通过，PG等待隔离CI。

整合单测跟进（2026-11-01 Asia/Shanghai）：root全量单测报告matching-local-source旧fixture缺少actor.user且所有SQL都返回收费条款行，与新回执/账本核验不符。已补完整最小合成Actor，按SQL返回空回执/准确条款/canonical binding；新增STAFF与TEAM旧回执拒绝重绑，以及缺失/金额归属不符账本拒绝用例，不改生产要求。3组定向单测27/27、API typecheck通过。

付费恢复证据补齐（2026-11-01 Asia/Shanghai）：root授权修复matching自有恢复脚本，map负责共享createLocalSource的paid:true能力。本脚本请求paid:true并使用返回tradeOrderId/termsId/totalFen；移除事后插收费条款的SQL。源条款先真实创建和独立审核，原预约在同事务捕获canonical trade_order，明确consent；本脚本只合成matching九表关系，不补造资金账本。

capture与verify均核对资金订单与预约的source/org/payer/beneficiary/slot/listing/金额、条款与商户、完整source_snapshot及TradeService原顺序source_hash、冻结quote，要求没有payment_attempt。正常恢复比较资金/条款不变；quarantine仅允许既有SOURCE_CONFLICT与REVOKED及对应version递增，身份金额quote哈希保持。按helper实际费用设置候选/预算/assignment，不再硬写另一金额。node --check、Prettier及diff检查通过；真实付费source创建与PG恢复仍待root隔离CI。依赖map helper提交2e8297e，未改共享helper。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
隔离恢复断言修复（2026-11-01 Asia/Shanghai）：root授权修正旧X12 quarantine与matching恢复检查冲突。普通重启/恢复现在严格比较九表完整行摘要、原预约完整行和全部reservation完整行；隔离只允许旧SQL规定的CONFIRMED→CANCELLED、固定原因、version+1、change/checkin清空及resource.active=false。来源其余列完整摘要、资金绑定、金额、席位/意向/assignment预算占用仍严格保留；所有updated_at精确等于RESTORE_QUARANTINE审计时间，不泛化忽略时间列。matching授权/需求/outbox及资金状态按具体变化精算。

验证：node语法、Prettier、git diff检查通过；临时mock SQL验证器接受普通/隔离两个正确状态，拒绝9种来源、资源、预算、资金或时间篡改。该检查只验证JS断言分支，不替代真实PG。真实archive恢复待root CI154；仅修改自有脚本与任务/交接记录，未改旧quarantine语义。

2026-11-01（Asia/Shanghai）共享退款收口追加授权：root委派trade-service/source-adapter/合同及对应测试、原生trade-order页；新worktree `/workspace/scratch/aad368826b09/scb-six-trade-retry`、分支`work/r6-trade-retry`、基线18c570a，开工clean，远端xyq-dev/small-city-basketball。ads持有重试链及四参数只读assertRefundRevocation事实hook，root持有wiring/ACL；dispatch协作者仅改本worktree的4个原生trade页/测试路径，不单独提交。特殊APPROVED退款REJECT沿common独立manager/operator及fresh session权限，限定广告恢复未发送且祖先已成功；APPROVE也在相同锁下复核来源。GET限广告确切退款过占给真实金额冲突视图，不放松任何写路径。进行中，验证待补。

共享退款收口实现完成：optional assertRefundRevocation仅供SPONSOR_ORDER未发APPROVED后继，实际状态fence/provider_refund_id/success_at必须全null，原immutablebinding的kind/source必须一致；沿用common独立manager/operator、排除付款/收款/提议人且提交前fresh session。APPROVE在PENDING阶段也复用source dispatch核验，源事实变化时整笔拒绝。原命令回放仍沿旧operation机制，不删除或重绑历史。root统一接ads只读hook，本片不改wiring。

GET每条退款返回canRejectApprovedRefund；仅广告退款过占且其它已结金额全部经原严格计算通过时，balanceConflict只读保留实付/已退/全部占用、可退0，写路径仍严格。原生页按退款ID独立确认撤回，身份/版本/刷新变化清空；冲突时禁资金执行和重试，仅保留原号查询与受控REJECT。协作者dispatch完成UI，training独立审查指出restore quarantine503会挡历史页，已仅将明确SPONSOR_RESTORE_QUARANTINED映射能力false，mutation仍拒且其它503/SQL不吞。

验证：全项目typecheck、38项定向(33新增+5资金领域)、17原生测试、完整API source 1335/1335及格式/diff检查通过。首次全source仅新unit“负金额”夹具未触发原计算器错误导致1项失败（1333项通过），改为确切非整数过占后最终全source全部通过，未放宽生产计算器。真实PG新增文件由dispatch协作补写中，本机无PG未执行；完整真实ADS retry链由ads模块PG另验。未生产、未远端写、无Migration修改。

共享退款PG追加（2026-11-01 Asia/Shanghai）：协作者dispatch在本worktree补`r6-trade-refund-revocation.integration.test.ts`，8个test声明/16个展开场景，真实migrated PG/auth/会话与原生sponsor source reader、真实captureSourceCharge/captureSourceRefund和immutable binding。签约、付款确认和迟到渠道事实明确为SQL合成fixture，domain资格hook为受控测试替身；真实ADS祖先/后继完整链由ADS专属PG另验，不能混称本文件是完整生产角色旅程。

覆盖PENDING APPROVE来源复核失败无mutation/无出网；过占GET保留1000实付+1000已退+2000占用并可安全拒绝未发送后继；旧版本拒绝、成功只增一次version且原command重放、原binding不可改删；付款人/收款人/提议人独立审核拒绝；7种状态/已发证据、3种绑定缺失或错配、hook缺失/事实拒绝/隔离关闭；事务末fresh失效全部回滚及真实已撤销session入口拒绝。全项目typecheck、单文件Prettier、git diff检查及Vitest用例收集通过，本机未执行PG。下一步root cherry本片并纳入CI156的R6真实PG早检，生产/外网/真实资金未触及。

PG夹具独立复核：map逐项比对030/038/047/048、source consent/商户/hash、角色与金额、session/version/replay后无确定SQL/API阻塞。本人另对root最新047与18c570a差异确认只新增retry关系及history规则，不改变本夹具旧source约束。该只读结论不替代真实PG执行。


2026-11-01（Asia/Shanghai）培训日历补筛 P2 开工：root 按 PR review PRRT_kwDOVTBG086yXXZC 授权，在 `/workspace/scratch/aad368826b09/scb-six-matching-training-calendar`、`work/r6-matching-training-calendar`，基线 `f66306c0bfa144b8c63a23c7403e59454b19da2d`，origin 为 xyq-dev/small-city-basketball，开工 clean。仅修改 matching-service、matching PG 测试及本任务/交接；dispatch 协作只写该 PG 文件、不单独提交。补 active 培训占用的候选/意向共用检查，严格沿 048 的 HOLDING 到期语义和半开区间；不修改 Migration/ACL/DTO，不在读取路径清理资源。TEAM 意向尚未选择球场，不从地址推断 courtId；实际已确认场地仍沿原源预约和 048 锁校验。计划类型/相关单测与真实 PG 用例收集，本机无 PG，运行证据交 root 隔离 CI。


培训日历补筛 P2 完成（2026-11-01 Asia/Shanghai）：calendarClear 现在只读检查 active training_resource_reservations，沿 c06_booking_window 的 [报到,结束+30分钟) 与培训已含缓冲的存储区间判断重叠，不重复加培训缓冲。仅关联报名处于 HOLDING 且数据库时钟已到期时忽略；CONFIRMED / PAID_UNALLOCATED 的历史锁位截止时间不释放日历，未关联报名的教练占用照常阻断。候选生成/详情与发送、接受、转单重验共用此逻辑，原转换资源锁及 048 约束仍为并发最终防线。TEAM 筛选明确授权代表人的培训占用，尚未选择球场时不推断 courtId。

新增 5 个展开 PG 场景：PLAYER/STAFF 各含 7 分支矩阵（教练、CONFIRMED 旧截止、有效 HOLDING、PAID_UNALLOCATED 旧截止、已过期 HOLDING、已释放、半开相接）；两类各验证候选生成后新增培训导致 SEND 和 ACCEPT 拒绝，席位/意向/assignment/outbox 完整行不变、无回执，释放后原 commandId 可成功；TEAM 代表占用加入和释放后候选相应变化。夹具明确为 SQL 合成的培训数据，保留真实外键、排他约束与 048 触发器，不禁约束；过期报名插入后才推进截止，证明读取不清理 active 行。

验证：API typecheck、27 项撮合领域/本地源/球员源单测、定向 Prettier、git diff 检查以及 PG 文件 Vitest 收集通过。第一次从仓库根运行 Vitest 时配置相对 include 未找到测试，随后在 apps/api 正确目录重跑通过；这不是业务失败。dispatch 协作编写 PG，ads 独立审查源码及真实迁移夹具无 P1/P2。新增 PG 尚未本机执行，root 需将本片纳入下一次隔离 CI；无 Migration/ACL/DTO 变更、无生产或远端写入。本地 commit 后由 root 集成同步，不能标为 main / 真实 PG 已通过。
