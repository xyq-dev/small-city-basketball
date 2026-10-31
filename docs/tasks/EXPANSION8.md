# EXPANSION8：商业版剩余八项真实实现

2026-10-31 Asia/Shanghai；集成人本会话Codex root；IN_PROGRESS / LOCAL_ONLY。

用户本轮明确要求下列八项全部先开发代码。总范围不因某切片完成而缩减；缺真实供应商时完成持久业务流程、严格provider边界、页面和隔离验证，实际外部开通另列，不把接口空壳/Mock当实际完成。现有代码及前批F01—F22保留复用。

## 现场与授权

远端main47293366afe3ebfe88392b15261ca431d5452162，tree042af74a61fd6df1e938d13b7bbddcd2b6e570fc；本地作者基线8e1ae9129f528bb672e7c672d89f72d1621c1637同tree。集成目录/workspace/scratch/6da762100066/scb-expansion8，分支feat/commercial-expansion-8，开工干净；保留所有旧worktree。已读AGENTS/CURRENT_STATUS/TASKS/COLLABORATION及相关需求。原开发、测试、commit、普通同步、PR与审查后合并授权沿用；禁止生产部署/生产Migration/生产数据、真实付费资源、新正式外部凭据和公网端口、强制覆盖。

## 固定范围与所有权

| ID | 范围 | 状态 | 负责人 | 必须交付 |
| --- | --- | --- | --- | --- |
| E01 | 手机直播/云端比分合成/多平台分发与停流 | DESIGN | streaming | DOC005真实任务/源/目标/epoch/fence、预检、密钥边界、provider、页面与恢复 |
| E02 | 整场录像/转码/自动集锦 | DESIGN | streaming | 与直播独立的媒体任务、实际FFmpeg/产物/授权/用量、失败和撤销链 |
| E03 | 在线保险 | DESIGN | insurance | 产品/报价/投保/外部付款/出单/查单/退保和资格联动，保单与支付分离 |
| E04 | 真实业务资金闭环 | DESIGN | trade | 现有预约/报名/保证金的服务端报价、支付/退款/对账/结算；不建钱包，不复制造款 |
| E05 | 微信通知/消息中心 | IMPLEMENTING | notification | 显式订阅、真实业务事件、可靠outbox/worker/幂等/重试与授权撤销 |
| E06 | 跨赛事/球队/球员统一搜索 | DESIGN | root | 当前公开授权和白名单、城市与分类、分页及来源撤回即失效、页面 |
| E07 | 自助账号注销 | IMPLEMENTING | closure（原risk_review，root终审） | 重新认证、业务阻塞/延期、冷静期/撤销、会话/授权清除、最小历史保留及恢复防复活 |
| E08 | 青少年/监护确认 | DESIGN | youth | 未成年身份/监护关联验证、本人及监护独立同意/撤销、报名冻结门槛和隐私边界 |

所有域先提交简短规则/数据/API/权限/失败恢复设计，由root及独立review完成必要高风险审查后开始业务写入。已通过的独立域可先推进，不等外部凭据。

## 路径与共享文件

各域独立worktree/分支；仅写新域独占service/domain/controller/provider/测试、分配的新页面/组件、专属contracts文件和自己的E卡/交接。root独占app.ts、service.ts、共享index.js/index.d.ts/package.json、全局app.json/路由allowlist、现有核心业务接线、依赖/锁文件、运行时/ops/CI、API_CONTRACTS/DATA_MODEL及汇总；不得他人覆盖共享文件。

迁移连续分配：036_e01_streaming_media.sql给streaming；037_e03_insurance.sql给insurance；038_e04_trade.sql给trade；039_e05_notifications.sql给notification；040_e07_account_closure.sql给root；041_e08_youth_guardians.sql给youth。旧001—035冻结；各域允许本地编写DDL，不自行运行任何数据库。root统一41迁移链、最小权限、readiness、非空重启/备份恢复；新迁移首次成功执行后不回改，后续另加迁移。

每个可验证切片与自卡本地commit后给root SHA；root核验、整合并同步GitHub后继续下片。最迟15分钟记录checkpoint。外部官方协议仅依官方资料实现；没有选定保险/云供应商的流程明确不可真实执行，不伪造发信/推流/投保/支付成功。

## 验收与恢复

需源码/类型/格式/构建、真实PG事务与并发、原生页面→真实API、三宽布局、provider合成网络契约、完整新表真实非空重启/备份恢复、恢复后支付/推流/授权防重放。资金/保险/注销/监护及直播外部成本状态机须独立复核；未执行测试明确记录。

检查点0：新分支已建立；当前仅父卡与分工设计，无本轮新业务代码或测试结果。下一条：各owner短设计→必要review→按分配路径实现；root并行完成搜索和注销设计/接线，不在任一模块交片后结束八项总任务。


检查点1（2026-10-31 Asia/Shanghai）：五域设计及root注销/搜索设计已完成必要审查，已批准开工；原risk_review转为E07独立实施，由root最终复核。E03新增资格预审（037，qualification-precheck模块/页面，owner仍insurance）打破C23最终审核先保险与投保前资格互锁；E08增加未满14数据处理预同意，参与与公开用途另核。E04必须JSAPI及NATIVE两通道，不把不可逆openid_hash当付款地址；root负责旧支付client可选JSAPI扩展和可信payer resolver。E07默认无强制等待、可选最多7天延期，绑定安全版本，旧备份依赖quarantine，不虚称DB tombstone永久覆盖所有备份。

已整合E05首片ea9a439+cee49bd为eddb7fe/f89582e：039/domain/固定官方微信REST provider/共享类型与18单测，作者全API类型/格式通过；DDL未执行，service/UI/PG仍待，不报完成。root将同步分支后通知继续后片。
