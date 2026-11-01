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
