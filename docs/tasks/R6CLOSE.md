# R6CLOSE：六模块注销与隐私闭环

2026-11-01（Asia/Shanghai）。root追加委派；implement_insurance负责。工作目录 `/workspace/scratch/aad368826b09/scb-six-insurance`，分支work/r6-insurance；切片基线dd6ebb6。状态 `IMPLEMENTED / LOCAL_ONLY`。

依据各模块最新044–047实际schema（含training guardian cohort/policy范围、dispatch不可变报价/hold、sponsor十表）。新增remaining-six-privacy.ts；AccountClosureDependencies强制检查remainingSix四函数，缺失时关闭注销；ACCOUNT_CLOSURE_DOMAINS增加TRAINING、MATCHING、DISPATCH、SPONSOR_COMMERCE。类型允许旧composition暂不注入，但运行时绝不把缺域解释为无事项。

实施：先汇总用户实际涉及的培训/撮合/派单/广告机构，与原组织集合排序合并后获取组织/共享日历锁；新模块source行全部NOWAIT，撮合联系consent使用原4402 try-lock，竞争重试。检查学员/教练未完成服务、扣课争议/退款（PENDING/UNKNOWN未结；已确认为FAILED的旧分配保留，未消费课次仍阻断）；双方意向、原业务订单仍未结/缺源；跨城邀约/人员占位/原服务；广告合同与履约以及独立多方分账、渠道完结、分账回退、退款和追回。后者与既有TradeService.assertAccountClosureSafe双层执行，不用本地UNKNOWN假造完成。

仅安全结案时撤回matching发现/联系偏好、关闭自有需求和未转单意向、取消相关待通知；撤回dispatch偏好及自己过期未转单offer/hold，保留他人后续获选hold与所有已转原单；撤回教练同意、training监护授权并递增版本/epoch。候选、命令收据、合同、订单、资金、出勤及所有历史不删。

验证：注销domain+R6 helper定向20/20、小程序注销7/7、API typecheck、diff check通过。新增真实PG6例覆盖waitlist/剩余补课/UNKNOWN退款、教练待交付/监护撤回、consent竞争NOWAIT、双方意向与通知撤回、历史declined派单方不误释放他人hold、源已CLOSED但多方UNKNOWN回退仍阻断。旧closure两套真实PG接真实R6依赖。真实PG未在本地执行，需root/CI在完整迁移集执行。

待集成：root在expansion-services注入四函数（详交接），并执行上述PG+全部closure回归；未改其文件。没有生产操作。

复核补充：培训agent确认退款FAILED是已终结失败且课次退回MAKEUP_DUE，后续可创建新分配。删除旧FAILED永久资金阻断，仍由MAKEUP_DUE/剩余权益、新未决退款和canonical trade检查阻断；PG用例覆盖旧FAILED保留但新退款成功后可安全结案。

广告复核补充：ads agent确认RECOVERED/WRITTEN_OFF是双人独立核对证据的追偿终态，不改原渠道FAILED。helper仅在FAILED且绑定case有不同提议/复核人、有效证据和明确终态时不把旧失败永久计未决；UNKNOWN/PROCESSING不受此例外影响。canonical trade资金余额与平台垫付检查继续必须通过，不能凭人工case跳过资金核验。PG用例用048实际SPONSOR_ORDER kind并覆盖此区分。

CI150夹具修复：六例初始化均因password_hash长度约束失败，现统一在beforeAll使用正式hashPassword为仅回滚的合成用户生成随机密码哈希；不弱化生产约束。同时逐项核对根f7dcb03的044–048 schema，修复dispatch持有报价必须含与quote_hash一致的hash字段。API typecheck及diff check通过；真实PG仍待root/CI重跑，未将静态核对称为PG成功。
