# EXPANSION8：商业版剩余八项真实实现

2026-10-31 Asia/Shanghai；集成人本会话Codex root；IN_PROGRESS / BRANCH_ONLY，PR34隔离验收中。

用户本轮明确要求下列八项全部先开发代码。总范围不因某切片完成而缩减；缺真实供应商时完成持久业务流程、严格provider边界、页面和隔离验证，实际外部开通另列，不把接口空壳/Mock当实际完成。现有代码及前批F01—F22保留复用。

## 现场与授权

远端main47293366afe3ebfe88392b15261ca431d5452162，tree042af74a61fd6df1e938d13b7bbddcd2b6e570fc；本地作者基线8e1ae9129f528bb672e7c672d89f72d1621c1637同tree。集成目录/workspace/scratch/6da762100066/scb-expansion8，分支feat/commercial-expansion-8，开工干净；保留所有旧worktree。已读AGENTS/CURRENT_STATUS/TASKS/COLLABORATION及相关需求。原开发、测试、commit、普通同步、PR与审查后合并授权沿用；禁止生产部署/生产Migration/生产数据、真实付费资源、新正式外部凭据和公网端口、强制覆盖。

## 固定范围与所有权

| ID  | 范围                                   | 状态         | 负责人                             | 必须交付                                                                      |
| --- | -------------------------------------- | ------------ | ---------------------------------- | ----------------------------------------------------------------------------- |
| E01 | 手机直播/云端比分合成/多平台分发与停流 | VERIFYING    | streaming                          | DOC005真实任务/源/目标/epoch/fence、预检、密钥边界、provider、页面与恢复      |
| E02 | 整场录像/转码/自动集锦                 | VERIFYING    | streaming                          | 与直播独立的媒体任务、实际FFmpeg/产物/授权/用量、失败和撤销链                 |
| E03 | 在线保险                               | VERIFYING    | insurance                          | 产品/报价/投保/外部付款/出单/查单/退保和资格联动，保单与支付分离              |
| E04 | 真实业务资金闭环                       | VERIFYING    | trade                              | 现有预约/报名/保证金的服务端报价、支付/退款/对账/结算；不建钱包，不复制造款   |
| E05 | 微信通知/消息中心                      | VERIFYING    | notification                       | 显式订阅、真实业务事件、可靠outbox/worker/幂等/重试与授权撤销                 |
| E06 | 跨赛事/球队/球员统一搜索               | VERIFYING    | root                               | 当前公开授权和白名单、城市与分类、分页及来源撤回即失效、页面                  |
| E07 | 自助账号注销                           | VERIFYING    | closure（原risk_review，root终审） | 重新认证、业务阻塞/延期、冷静期/撤销、会话/授权清除、最小历史保留及恢复防复活 |
| E08 | 青少年/监护确认                        | VERIFYING    | youth                              | 未成年身份/监护关联验证、本人及监护独立同意/撤销、报名冻结门槛和隐私边界      |

所有域先提交简短规则/数据/API/权限/失败恢复设计，由root及独立review完成必要高风险审查后开始业务写入。已通过的独立域可先推进，不等外部凭据。

## 路径与共享文件

各域独立worktree/分支；仅写新域独占service/domain/controller/provider/测试、分配的新页面/组件、专属contracts文件和自己的E卡/交接。root独占app.ts、service.ts、共享index.js/index.d.ts/package.json、全局app.json/路由allowlist、现有核心业务接线、依赖/锁文件、运行时/ops/CI、API_CONTRACTS/DATA_MODEL及汇总；不得他人覆盖共享文件。

迁移连续分配：036_e01_streaming_media.sql给streaming；037_e03_insurance.sql给insurance；038_e04_trade.sql给trade；039_e05_notifications.sql给notification；040_e07_account_closure.sql给root；041_e08_youth_guardians.sql给youth。旧001—035冻结；各域允许本地编写DDL，不自行运行任何数据库。root统一迁移链、最小权限、readiness、非空重启/备份恢复；新迁移首次成功执行后不回改，后续另加迁移。

当前036—042均已在隔离CI首次执行并冻结，042为成年本人资料再同意；生产未执行，后续DDL从043追加。

每个可验证切片与自卡本地commit后给root SHA；root核验、整合并同步GitHub后继续下片。最迟15分钟记录checkpoint。外部官方协议仅依官方资料实现；没有选定保险/云供应商的流程明确不可真实执行，不伪造发信/推流/投保/支付成功。

## 验收与恢复

需源码/类型/格式/构建、真实PG事务与并发、原生页面→真实API、三宽布局、provider合成网络契约、完整新表真实非空重启/备份恢复、恢复后支付/推流/授权防重放。资金/保险/注销/监护及直播外部成本状态机须独立复核；未执行测试明确记录。

检查点0：新分支已建立；当前仅父卡与分工设计，无本轮新业务代码或测试结果。下一条：各owner短设计→必要review→按分配路径实现；root并行完成搜索和注销设计/接线，不在任一模块交片后结束八项总任务。

检查点1（2026-10-31 Asia/Shanghai）：五域设计及root注销/搜索设计已完成必要审查，已批准开工；原risk_review转为E07独立实施，由root最终复核。E03新增资格预审（037，qualification-precheck模块/页面，owner仍insurance）打破C23最终审核先保险与投保前资格互锁；E08增加未满14数据处理预同意，参与与公开用途另核。E04必须JSAPI及NATIVE两通道，不把不可逆openid_hash当付款地址；root负责旧支付client可选JSAPI扩展和可信payer resolver。E07默认无强制等待、可选最多7天延期，绑定安全版本，旧备份依赖quarantine，不虚称DB tombstone永久覆盖所有备份。

已整合E05首片ea9a439+cee49bd为eddb7fe/f89582e：039/domain/固定官方微信REST provider/共享类型与18单测，作者全API类型/格式通过；DDL未执行，service/UI/PG仍待，不报完成。root将同步分支后通知继续后片。

检查点2（2026-10-31 Asia/Shanghai）：root已写WechatPayClient可选JSAPI及profitSharing，旧Native默认payload和查询通道不变。JSAPI绑定配置AppID/merchant/可信openid与预支付号，生成小程序RSA paySign；显式allowJsapi才接JSAPI query/notification，调用后不认定已付款。现有+新增55项支付provider源码测试及全项目typecheck通过；首轮两项失败因合成Response被多次读取，改为每次新signed Response后通过，未弱化验签。真实微信/商户资金未调用；payer resolver和trade实际页面/业务接线尚待。E06已同步，E05/E07/E08新域内核仍待完整service/UI/真实PG；八项总范围保持。

检查点3（2026-10-31 Asia/Shanghai）：已整合E01持久开停播/媒体worker、E03保险编排/明确DRAFT预审/页面、E04订单退款结算/真实微信分账回退协议、E05订阅与消息页及撤销竞态、E08监护服务/页面。E07服务/UI仍待下一片。root补收费source事务capture与履约门槛、原生JSAPI当前绑定身份双重核验、Native长录像下载清理、报名审核消息capture；API类型和31领域/身份测试、4长媒体VM通过。036—041仍全部未执行，外部投保/微信/推流/真实资金均未执行，所有八项仍BRANCH_ONLY整合中。C23保险/未满14同意门槛和当前公开用途、通知实际业务hook由owner并行接入，root后续统一路由/运行时/最小权限/真实PG与恢复验收。

检查点4（2026-10-31 Asia/Shanghai）：全域controller/DI/worker已在root接线，C23对当前数据预同意/监护参与/在线保单证据重新核验，保留外部保单。全局68原生页面注册及精确方法allowlist、监护proof专属限流6MB上传、私有proof/保单下载；账号/赛事/比赛真实入口与收费报名preview已整合。root独立复核并修正：JSAPI resolver返回assertCurrent在付款最终事务重核，分账批准/派发重算额度，派生录像继承源撤权，直播worker只在app.init后启动且等真实进程关闭。早一候选源码1080测试通过，最新新增22针对性测试/全API类型通过，38新消费者VM通过；最新整合仍需全量回归。恢复永久audit marker已加app启动强制旧新外发关闭（不提供普通API解除），待quarantine同伴补丁。037还会新增不可变保单历史表，036—041均未执行，不标PG或真实外部验收。

检查点5（2026-10-31 Asia/Shanghai）：八域完整源码与旧业务门槛已整合；extra恢复helperE01/E03/E05/E07已提交，主非空恢复接线/E04/E08仍进行。最终草稿全链静态41迁移/175表/117函数通过；038已收口对账money_version/分账回退10表，041已收口真实cipherbytes配额，尚未首次DB执行。root补后台quiescence开关、生产媒体持久卷/FFmpeg、永久restore marker全外发关闭，修纯HTTP无DB回归且production仍先readiness；2份错误scb-header引用修正，live/web组件预览只显式placeholder。候选1114 API、561 admin通过；native995通过/1skip/1旧异步回归，已以5ca9b2f补preview await，相关16消费者回归通过，最新全量待CI。当前<14按资料处理日的修正325ae23已整合，不以未来赛时年龄绕过。正式外部/真机/生产与完整PG/恢复仍未验，不标DONE。下一步提交PR启动首41链隔离CI；首次成功后036—041冻结，后续DDL另加。

检查点6（2026-10-31 Asia/Shanghai）：[PR34](https://github.com/xyq-dev/small-city-basketball/pull/34)已开draft。首CI41180762746 preflight因dist runner未先build失败，已a489修；第二CI41181003895实际PG报037 references entries(org_id,id)无唯一键，整个migrate BEGIN事务ROLLBACK，未提交本轮DDL。root现将四处FK改为已有entries(org_id,event_id,id)组合键并保留机构/赛事隔离，旧001—035不动，静态41/175/117仍通过；新失败诊断保留migrationName。997小程序测试通过/1既有平台skip，后续新模板lint再回归。发现旧三页53处动态wx条件漏{{}}，已修原生binding且新增全项目source守卫，8相关VM通过；本地Chromium缺浏览器二进制，36新填充三宽测试未执行成功，仍由CI验证，不冒称截图过。E03独立复核的provider/fence源码修已整合；本人显式query-only预算恢复仍进行。E08已授权新增042不可变成年资料自同意事实，修监护撤回/注销后已成年本人重新授权及成人原流程兼容，不回改041；该片仍待，当前已交48表完整恢复源码（尚未DB验）。

检查点7（2026-10-31 Asia/Shanghai）：CI41182154976（remote778dffa4）API job124481591194完整001—041迁移预检SUCCESS，第一次实际提交本轮DDL；036—041由[冻结清单](EXPANSION8_FROZEN_MIGRATIONS.json)固定sha256，后续DDL从042增加，不再回改已执行文件。业务PG/恢复/浏览器尚在运行，不能记作全CI成功。最新本地完整1135 API／561 admin／998小程序通过＋1平台skip，类型/格式/构建过。第二轮浏览器9失败均为直播/媒体input高度<44px或字号14<16px，root已修两页输入框尺寸，6VM过，第三轮浏览器待核。新增042成年自同意正在实现（独立年龄证据+当前材料scope pin、不能恢复旧公开许可）；root已把C23/qualification guard实际entry/member scope接好，避免跨材料授权。当前外部仍零调用。

检查点8（2026-10-31 Asia/Shanghai）：第三CI41182154976 admin完整SUCCESS，1135 API/561 admin/998原生源码+1skip、1067兼容浏览器与1053布局PNG；真实PG533过/27失败/7跳过，production启动缺ops/db模块。现整合E01真实APPROVE依据、E07正确权益关联/P07测试分段、E05全局无许可积压公平派发与补扫、E03原单query-only预算恢复、042独立成年资料处理再授权及14VM。root补042最小权限/原生allowlist/恢复追加撤权SQL一致性、C19初始调度行、E04独立审核人、旧导入预览timestamp约束、测试定时worker静止及Docker运行依赖；42/176/117静态和完整类型通过。环境回收旧scratch导致共享git/node backing消失，已保全各域源码，依缓存离线恢复依赖；从GitHub精确重建778dffa4 commit/tree/blobs浅历史，当前文件未回退。此前本地555b1e5至c09a6d3提交对象随回收消失，但源码和原卡证据完整，本片将从远端778重新commit普通快进；未force push。E08并发撤权fence/用途独立epoch与E07人工收款未决claim仍由owner下一片完成，所有外部零真实调用。

检查点9：第四CI41184782485/api124489387413完整42链首次成功，042 checksum和单独证据已补冻结清单，后续DDL从043开始，001—042不可回改。第四production build因root误将build-stage ops/db只复制两个.mjs而漏.d.mts失败，已恢复build-stage完整ops/db，runtime仅保留实际必需privileges/common；此前运行时缺模块问题仍需下一CI确认。1149 API源码过/1 readiness静态旧41计数失败，已将实际42及新adult表不可变权限验收补齐，针对17项通过/构建通过；本地原生进程exit0但日志没有最终聚合，故不以推算数字记通过数。E07新增真实待审人工到账claim阻塞/独立终结PG片84d76a7已整合，未执行新PG；不得把已有preflight当完整业务/恢复通过。

检查点10：root独立复核E06原始LIMIT会让已撤权候选占首页，已整合22b5eff有界补扫/精确cursor和4服务回归（不放宽当前授权）；E04独立审查发现默认无材料要求时FREEZE遗漏资金门槛，root在每个获批entry冻结前独立核两资金kind，GET能力仅将明确TRADE_PAYMENT_REQUIRED显示canFreeze=false；真实退款后freeze及免费对照PG正由E04owner补。RR资格独立性由team grants/bindings决定，root对实际领队授权、邀请接受及历史认领新binding做现有team tuple fence，不改业务version/更新时间；C23/青年owner分别补材料清除和授权append事实fence，均无DDL。恢复只读审查发现stop proof早于graceful shutdown，876227c已在静止后取exact proof；账单日改取本次paid_at而非当前时钟，避免跨午夜。最新本地完整API1150/1150，原生明确TAP1008通过+1平台skip/1009，42静态及类型通过；新PG仍待，外部服务零真实调用。

检查点11：第四CI API最终555通过/15失败，真实E03四场景、E04七场景、E07十二场景、E08原四场景及新成年三场景均通过；仍失败E01七条同APPROVE参数类型、E05七条全局fanout准备、旧P03一条锁等待观察。root已整合cb98b2c显式uuid cast并补录制开关PG；aa36783新增收费报名真实退款pending/processing/success禁止freeze和旧免费对照三PG源码。P03只关闭该等待PID测试harness的自动worker，保持实际提交/审核/冻结互锁和全断言，防通知worker同event等待被误认HTTP事务，仍待真实复验。19ab404补首次青年material用户tuple、实际清除event tuple和五条实际RR接口契约；root先接已获E08owner同意的稳定helper以解依赖。全项目类型/51针对源码及E06/权限25项过；cleanup10项另检。通知owner已定位紧急开赛源被7天审核源FIFO压住，将做有限10页紧急优先/轮转和真实pending规模显式全局准备，E08epoch/fence最后片正收口。42冻结DDL/生产边界不变。

检查点12：24389a6整合E08当前event与首次global youth user tuple fence、成年处理撤回后的独立公开用途epoch；3新真实PG源码（其中adult公开case扩原文件）均待验，不回改042。root复核users/team/event顺序、closure union preconsents与原事实保留，未见新增确定问题；独立同伴review通过。最新完整API1158/1158、格式/全类型/APIbuild过，原生TAP1008+1skip为前一UI相同候选；最终E05紧急fanout片待集成后启动第五CI。同步将普通快进现有PR34，仍draft，不提前merge。

检查点13：E05当前完整修片2783e8e已整合：live fanout仍每轮10源，2h紧急层优先、层内updated_at轮转，过期独立最多100收尾；不以增加LIMIT掩盖积压。PG显式按真实pending规模推进全局源，逐轮要求进展，保留25条无订阅更老积压和紧急review共享份额/到期边界探针，仍待CI实际执行。root当前全类型/44通知源码/42静态通过；下一操作将所有已提交集成普通同步PR34并跑第五CI。主源码1158完整已过（本E05业务改动随后44针对回归），所有外部零调用。

检查点14：第五CI41186594264/admin124494659094完整SUCCESS（1158 API/561 admin/1008原生+1skip、1067浏览器、1053布局PNG、类型格式构建），root已读原始日志并核artifact13036009981。API124494658981真实PG580过/4失败：新E04三case被旧DTO optional字段false省略断言卡住，c70bc1b兼容断言且加DB实际false证明；E05一case按两review source得50条正确消息，e95f1d9把三处统计固定到exact原source，仍严格25且不改单轮LIMIT/UNKNOWN断言。其余E01八、E08十、E07十三、C23十五、公开RR三及旧P03二十四等真实PG全过。production124494658902构建/健康/HTTPS/额外PG21过，captureStreaming缺APPROVE reason422，root同时补APPROVE/STOP合成依据；独立逐输入复核未见下一处确定阻断，仍待实际完整恢复。新增使用指南与真实菜单路径，未宣称外部开通。下一步普通同步当前全部修片，跑CI6；原迁移冻结、无生产/真实外部动作。

检查点15：第六CI41187725651已终结：admin124497943783与production124497943571完整SUCCESS，原始日志已读。1158/561/1008+1skip、1067兼容浏览器/1053布局PNG、额外PG21与HTTPS4过；生产包检查真实完成176表精确备份、第二PG/卷恢复、业务快照/fencing、旧凭据与授权quarantine及仅自有清理。新增49表由实际capture与全非空库存断言覆盖；MP4仅合成字节检查，DB备份仍不含媒体文件。API124497943779的584真实PG全部通过，21原生HTTP中19过，两旧预约consumer仍同步调用新异步review，未等fee preview；root只补await/settle，未改应用或弱化资金断言，新5消费者全过。最终余下API重启/浏览器步骤因前置失败未执行；第七CI继续。独立文档复核发现DATA_MODEL首库存旧48/175与未执行文字、通知15分钟误写调度周期，现校正；README/需求/架构/验收入口对齐后续实现并保留历史，不把旧DOC设计当当前缺代码清单。
