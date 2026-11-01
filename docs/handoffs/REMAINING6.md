# REMAINING6 整合接续

2026-11-01 Asia/Shanghai；IN_PROGRESS / BRANCH_ONLY。读[任务](../tasks/REMAINING6.md)、[六项设计](../design/REMAINING_SIX_FEATURES.md)与[运行配置](../operations/remaining-six-runtime.md)。

root目录 `/workspace/scratch/aad368826b09/scb-six`、分支 `feat/remaining-six`；基线main c61ab3667c9d3f756244a28046b9ee2395ccac00。GitHub主干并发UI001仅新增任务/交接文档，保留其内容。PR #35 草稿承载六模块实现，通过GitHub连接器按远端parent+expected SHA普通更新，逐次核验local/remote树完全相同。

已经接线：地图搜索、三类撮合原来源同事务转换、跨城真实源桥、培训与广告统一交易、多方分账/退款解冻/历史核对、注销、44张新表恢复隔离、5个原生页面。保险只完成准入/适配口，缺供应商协议及凭证，外部BLOCKED。新域默认关闭，无生产变更。

最近已同步root 7e3eb28→remote ab73b630dd9d3e846c424cee62f7f04b03c66115，tree4aa2c1745e589a85abea673119bd950adf5b222c。CI150三job失败：API新增R6阶段21failed/28passed/18skipped，主要fixture reviewer/hash、派单045错删owner约束、广告Date精度；admin匹配桥旧mock actor缺字段2失败；隔离生产包readiness及21项runtime PG已通过，随后缺R6恢复脚本打包失败。以上已定位并逐片修正，下一轮尚待执行。不得把失败或未执行项写成验收通过。

本地：完整format与typecheck通过；admin561单测通过；API1256pass/2旧fixture失败（修片549f343），微信1056通过/1Windows限定跳过；恢复离线11项、48迁移/220表/126函数静态清单通过。真实当前HEAD跨域PG、全量旧PG、归档恢复、隔离HTTPS及页面检查仍需CI。

仍在处理：普通广告主本人合同入口、学员补课目标选择器、PARTIAL广告已全退注销精算、派单资金桥测试；各owner仅改自己的路径。root串行app/账户入口/manifest/容器打包。下一步合并这些小片，启动当前HEAD隔离CI并修复失败；通过独立审查、全部必要检查后才mark ready/合入main。未测试不合并。

普通广告主入口已补：所有登录账号可从账户页进入本人合同；服务端inbox仅按实际payer筛选机构/合同，签署及资金操作继续原权限复核。新的MeController已在app注册，管理入口仍保留org上下文。新增真实Page渲染/导航测试与inbox隔离PG；后者待CI。

CI151新域真实PG已至66通过/3失败，余项为expiry/version与安全404的精确fixture预期；隔离production在构建前发现.dockerignore遗漏R6 helper，已补精确5文件允许清单，并新增从实际恢复入口遍历imports的打包测试，防止再漏transitive helper。正式镜像/恢复仍待下一CI，不因静态通过而标完成。

CI152新域PG步骤完整通过，旧业务还在执行；隔离production定位到旧同城book HTTP500：提取prepare时对append-only local_command_receipts加入FOR UPDATE，而runtime刻意无UPDATE权限。移除两处无必要历史行锁（仍持全局日历/源锁，operation重读+唯一键防重），不扩历史写权限。广告配置已复用原trade商户实现严格默认关闭装配，root补app及Compose普通开关，构造不外发。

全部已知入口/权限修正已集成：培训学员同课程候选选择器、仅锁平台操作员用户行；广告整数渠道上限及真实TradeService退款幂等/出网前复核；广告通过现有商户配置严格装配。当前无未提交业务代码，准备候选CI153。最新54项运行配置/源桥定向通过。等待真实PG、全量旧回归、完整220表恢复和独立审查最后结果，不提前合并。
