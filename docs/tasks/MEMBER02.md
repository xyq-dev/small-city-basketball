# MEMBER02 · 机构月/年会员与跨届额度

REVIEW / BRANCH_ONLY；2026-11-10 Asia/Shanghai。依赖[会员规则与建议定价V1](../design/MEMBERSHIP_SYSTEM.md)、用户已确认的视觉方向及MEMBER01现有按届基础。新Figma交接以MEMBER01记录的真实链接为准，不能猜节点。

目标：专业199元/30天3届、1699元/365天36届（16队128场）；商业399元/30天10届、3399元/365天120届（32队512场），买机构软件服务，手动续费，无自动扣费。

实施前重新核验真实目录、远端main、HEAD和未提交工作，创建独立任务分支，保留旧改动。不从本任务卡推定生产/资金操作权限。

1. 冻结兼容旧按届报价/订单/触发器的扩展契约；复用原商业付款、双人复核、原退款/查单幂等，禁止第二套支付、虚拟赛事或钱包。独立审查时效、续费、退款/发布同锁序及最后一额度并发。
2. 新增真实机构购买期、额度分配记录与必要Migration；001–051不改。数据由已核实原订单报价派生，起止/额度/来源不可变，不允许前端指定会员状态、价格或剩余额度。
3. 首次发布在原业务事务扣额/激活，失败全回滚，同届/重放不重复；按届已购优先，未核对交易阻断重复扣费。到期/耗尽不打断已激活赛事。
4. 按核验后的Figma开发会员中心、详情、核对、用量和状态；使用新的明确软件会员路由，不占用球队成员memberships。新页接真实契约，未接通阶段禁用付款且如实显示。
5. 新表最小ACL、manifest、迁移链、旧按届升级与完整备份第二PG恢复；支持购买期/分配与原激活事实完整恢复，不能只增加表忽略灾备。
6. 验证同机构/跨机构、未登录/无权/买会员不升权限、支付关闭/金额伪造/重复通知/未知查单、退款与最后一额度并发、精确到期/续费/无自动扣费、完整赛事闭环和桌面手机真实API。真实商户/微信真机仍另列，不拿fixture签名代替。

完成门槛：必要源码/类型/构建、真实隔离PG、两端真实API浏览器、恢复/旧库兼容、独立高风险审查、同一head CI，按本轮核验授权提交/普通同步/PR及合并；禁止生产部署/生产Migration/真实资金、新凭据、付费资源或公网端口。报告Migration已编写/已隔离执行/未生产执行分别列明。


## 实施认领

root唯一集成人；工作树`/workspace/scratch/dc6a786e1a31/scb-membership`，分支feat/MEMBER02-integration，基线ac6f700（前置MEMBER01 PR53正在隔离CI，不冒称main已合并）。开工干净，origin原仓库；所有旧工作保留。用户本轮明确要求完善会员系统，当前继续真实月/年核心实现，不以第一卡设计/按届修复代替。

root持contracts/index、app.ts/App.tsx接线、runtime manifest、恢复/CI与汇总。backend独立scb-member02-core：commerce contracts/newmembership contract、commerce backend、新052、直接PG/源码测试及自己handoff。Web实现先读已确认Figma并冻结契约，独立路径/工作树，禁止同写shared文件。现阶段先交付网页后台及手机响应式真正机构会员采购/管理；原生小程序稿已设计，原生新路由另卡接续，不冒称原生实现。

沿用已核验开发/测试/commit/普通同步/PR/审查后merge与隔离Migration授权。禁止生产部署/生产Migration/真实资金或账号、付费/新外部凭据/公网端口/force/改001–051；新增Migration必须单列编写/隔离执行状态。先审模型和锁序再写高风险代码，最终同head必要CI及独立审查。


## 2026-11-10 16:10 Asia/Shanghai 契约/设计冻结及root接线检查点

独立设计预审已通过68157b4；合同及元数据c8e0693已整合为6447f81/e54b566，index出口9c266fa。远端任务分支feat/MEMBER02-integration已同步合同检查点e0de988/tree4c61f4e（与本地9c树一致），不是main或完整应用实现。新模型仅一张software_membership_periods，消费直接用原不可变event_commercial_activations扩MEMBERSHIP+period来源，不另建重复账本。原EVENT报价/hash保持原形；会员eventId=null诚实类型，旧workspace按目标分流；history四域截断明确，资格/CAS/余量查全量事实。锁序与NULL唯一/周期重叠/退款及续费约束已审，实际代码与PG待验。

root已本地编写app.ts两新controller复用原service接线、App.tsx会员入口、RuntimeApp独立平台会员入口和原发布确认扣额提示（新增这些共享允许路径及其直接测试）；前后端实现者文件尚待整合，不提前声称完整编译。新增member02-membership-check HTTP恢复driver：原双人收款产生真实购买期，停售版本后由核心RR首次发布自然消耗1届，原订单与周期/余量/激活来源在实际PG重启/完整恢复后精确比对；原对账将member订单一并计入CSV，不改变全量总账。新helper打包白名单、三suite owned隔离runner、独立ENFORCED浏览器config已编写，测试文件与实际流程尚待完成。无生产变更。

直接恢复/包装pure6项已通过；新tree首次运行旧c05 pure测试因新工作树尚无编译dist而导入失败，已将仅capture才用的编译平台权限helper延后到安全目标验证后的动态导入，未改权限业务；相同6项重验通过。没有用其他tree编译产物冒充新源码。root/作者均使用各自node_modules链接目录，contracts明确指本树，未改共享依赖或包锁。052由core开发中，仅编写、未执行。

MEMBER01 PR53 ac6f700 CI42777587768已account/admin/production成功，api仍原生真实HTTP步骤；不拿其成功当MEMBER02新迁移已验收。下一步整合core/Web、精确ACL和真实E2E、完整检查及新PR隔离CI。


## 2026-11-10 16:17 Asia/Shanghai 核心首批已整合、审查修复中

root已整合core a08750f→e156e3f、SQL括号修复5aba1a9→4fabb62、撤销reason NULL约束6096470→9f70b87。052新增1个period表、两个trigger函数，已补真实最小runtime manifest（SELECT/INSERT，UPDATE仅revoked_at/revoke_reason；trigger EXECUTE[]）、app.ts同CommerceService controller接线、readiness完整52期望及新表/函数断言。root API类型/构建通过；实际完整API源码126文件1452项通过，不是PG验收。原先51计数/缺manifest两失败已按新增实际schema修正，没有放宽集合/权限比较。

独立高风险审查仍进行中：已发现并修真实SQL括号P1与NULL审计reason P2；仍有会员付款精度/人工确认跨到期窗口P2交唯一core作者修复，未批准新候选。052仅编写，未在本机或生产执行；作者独立真实PG文件和合成回调仍在写。root Web路由/发布确认提示、恢复driver/打包/新ENFORCED浏览器suite在本地未提交，依赖Web作者整合后才完整类型/构建。不要误报完整可用。


## 2026-11-10 16:49 Asia/Shanghai 最终集成验收候选

root树scb-membership，feat/MEMBER02-integration；核心abe已整合7683b9e、Native PG8已整合28d8485、Web最终cec4803已整合8dd1161。所有作者worktree/历史保留。新增真实PG共24项仅已编写；没有本机Docker/PG，不虚构执行。原单关闭仅接受可信签名CLOSED证据；超时/NOTPAY不当取消、后续SUCCESS不能复活已关闭原单。秒级原始付款时间/实际确认窗口、UUID互斥规范化和退款/激活锁序补丁等待最终独立复核。

root补完真实入口/权限菜单、旧按届明确Native关闭、发布扣额说明、52迁移与最小manifest接线；恢复驱动通过真实API两人核验生成购买期，停售后由原RR发布消耗1届，校验订单/购买期/35余量/原激活来源在实际重启及第二PG完整恢复精确保留。旧对账CSV纳入同一总账的会员订单，不排除新增事实。pure恢复/包装6/6已通过，完整类型及构建已在整合Native PG后通过。Web增量整合后全仓format/type/build/source正在重验，不能用前一候选成功顶替。

独立ENFORCED browser suite已编写：1440×1040和390×844，真实平台表单发布199月费和其余三档、买方核对、两账号收款复核、原赛事报名/冻结/草稿/正式发布扣额、用量/刷新与旧按届分流；另扩owned失败清理到三suite。测试证据仅合成数据，关闭trace/video与真实微信支付。真实浏览器尚待CI执行，原生微信页仍Figma设计；Native QR明确需另一设备微信扫一扫，不承诺手机本机长按/相册。

下一步：完整本地必要检查完成后仅精确路径commit/普通同步，创建新PR并跑同head真实PG/浏览器/HTTPS完整恢复；MEMBER01 PR53最新版1c2eac2 CI42782617688仍有API/admin在运行，不能提前merge。任何资金、生产部署/Migration/账号、付费/新凭据/公网操作均未执行。


root完整最终源检查：format/typecheck/build全部通过；npm test实测admin787、API1457、微信1638通过+1既有Linux平台skip、CLI12、storage11通过+1主机UID限制skip。6项恢复/打包pure再验通过。该结果不含真实PG/浏览器/微信实付。

core只读恢复复核发现旧captureScheduling在已购买会员后仍预期402会错误，已修为首次真正未付款发布先验证402/无副作用，再通过原HTTP购买会员；后续有已付购买期不再错误要求“没有按届单就失败”，同时原每届付款优先与全期仅消耗1届仍严格断言。未改业务守卫或放宽真实账本比较。新E2E三个真实浏览器上下文显式同源baseURL，平台页直挂无Router已补真实源码回归。下一步同步并以新PR真实隔离执行。


CI251第一候选f4eb4a5/tree4e83662d实际失败（run42785246811）：api迁移预检在052、42601、position9090；account-security同一迁移失败并已移除owned数据库，尚未执行PG24/真实浏览器。core最小修复35a54e1用括号包裹PLpgSQL IF中的CASE表达式，避免内部THEN被当外部语句分隔；只改052及自己交接，001–051不动。该候选不能称通过，修复后需新head完整真实CI。


## 2026-11-10 17:08 Asia/Shanghai 真实失败定位与精确修复

CI252 source dc2919de/tree99f79317（run42785649875）：052完整真实Migration预检通过；account-security及三suite owned失败清理SUCCESS。production21最小身份PG通过，但原HTTPS会员收款command500；API旧PG组3文件失败/641通过/16失败/5因C22前置失败跳过（662），不能称会员闭环或恢复通过。归档PG明确16次`inconsistent types deduced for parameter $5`：period INSERT同参integer/double类型冲突，core独立最小修复d978290→roota2373d1统一显式integer，不改额度秒数/业务guard；真实消除仍需新head复验。

已整合account closure真实P2修复e0ea31d→5aa6d96：会员PAID只有本org本单period真实消费才算履约，未用/下一期/别单不串清，退款/其他未决单及owner责任仍挡；新增1连续真实PG回归已编写，18项相关源码实测通过。已整合同秒相邻期P2修复bd7d4d5→7ff3f17：首次Native购买期起点SQL取GREATEST(原付款、原建单)，原付款证明不改，manual仍原付款，续费仍parent.end；源与052guard一致保6位微秒。新增第9项Native PG回归，MEMBER独立PG现25项另注销1；作者97commerce/type通过，root完整type/build/pure在重验。独立审查已复核这些源码delta，可进入新head完整CI，尚不构成merge或真实支付批准。

C22另一个真实历史升级失败已证实：冻结Scheduling仍导入current activation，导致001–022缺membership_period_id时500；其历史快照还需严格确认新列NULL后只排除此新增列。授权audit作者在独立树冻结83ae15a原activation完整旧函数、反向source hash/身份与最小projection，只修改测试fixture/对应source guard和自己的handoff；禁止生产探表兼容、补旧schema字段、改001–051或跳过原激活/audit。root新增CI把member25前置，旧组精确exclude防重复，所有旧PG仍执行。

MEMBER01最新1c2eac2：CI250原API/production/account成功，admin外部字体/Chromium下载后触25分钟job限时取消，没有把它算通过；相同head仅重试admin（现129730268249）。真实API桌面12/手机12通过，root已下载并实际查看两张定价草稿截图，原目录零POST断言保持；最终M1尚未merge。所有源码/隔离/真实商户/生产证据仍分列。root工作树/作者提交保持，不reset/clean/force。


2026-11-10 17:13 Asia/Shanghai：C22独立历史修复d12ae64已整合c9d8528（仅7个测试/自己交接路径），旧freeze从current helper解耦，原历史source blob/hash与逆变换保持，原activation/audit/22checksum不变；052新列必须先证实旧行NULL才从旧快照比较剔除。作者6项源守卫/type/format通过，真实旧库升级待新CI。源码主体a2373d1已独立复审允许新headCI；legacy delta另送复核。root最终全仓源码在跑，type/build/pure6已通过，未报告当前旧CI252全部成功。M1已按精确source/tree合入main cd8ed1f，后续普通整合其祖先关系，不更换测试代码或覆盖并行工作。


## 2026-11-10T17:16:25+08:00 新会员真实PG25通过、CI初始化顺序修复

source33fcc573/tree50880f0，CI254/run42788738030/api129736786828已真实执行并通过会员16+合成签名Native9共25项；原16个付款500未再出现，同秒相邻期/微秒续费/关闭证明/退款/并发扣额覆盖已实测。该结果仍非真实商户资金。之后R6培训19项beforeAll因SETUP_CLOSED被跳过，整个API仍失败：root将新会员组前置到R6前，改变了原空库首次初始化顺序。不是应用业务回归或可以忽略的测试；现把新会员组放回原R6完成后、旧大组前，保留所有验证/精确exclude且不重复跑；不修改生产初始化或R6测试以迁就顺序。此单一workflow修复需要新head完整CI，旧254其他成功项不冒充新head通过。052已隔离执行；生产仍未执行。

最后源码787/1457、微信1638+1平台skip、CLI12、storage11+1UID限制skip全部通过；完整format/type/build/pure6通过。legacy独立复核再次按真实83ae四文件逆变换逐字节相同，所有商业核心修复无未解决源码P1/P2。C22真实升级、注销新增PG、真实HTTPS付款/完整恢复与新会员桌面手机尚待新head。root普通merge M1 ancestry25b0298与前树0a051ac内容零diff，只解决两处本轮文档append末尾冲突且逐字节保持自身完整文档；代码没有丢失或改变。


## 2026-11-10T17:27:57+08:00 续费过期报价P2最小修复

自动审查r4523119657指出已分类expirable的安全未启动PENDING续单仍被children当有效后续期，导致POST在安全expire步骤前被拒。core8e46a77已整合d501b60：同mutex下children LIMIT前仅排除本次expirable IDs；Native/待审仍严格阻断，GET不清单，POST仍旧单先EXPIRED后建唯一新单、全部原报价/parent/审计保持。新增第17会员PG，连同Native9为26项，另有注销1；3秒合法初始pending DB真截止/读取零写/替换及重放与未决对照已编写。作者24领域/type/format通过，独立精确delta审查无P1/P2允许新head完整CI；新PG17还未执行，不冒称成功。

旧sourceb6d8/treeae0ee5a/CI255/run42789367210已通过会员25/R6147、账号安全，以及production129738666697的21runtimePG、真实HTTPS收款/原RR激活/同卷换IP重建、精确第二PG228表完整恢复/旧授权隔离/owned清理；root已读完成日志，原confirm500已实测消除。旧大PG组和新Web浏览器在该轮尚未结束；旧成功不能代替含续费新条件的最终head。补全中央API_CONTRACTS与DATA_MODEL中的真实软件会员入口/来源、秒/微秒规则与隔离/生产边界，不只放单卡。


## 2026-11-10T18:06:51+08:00 共享测试账本隔离修复与浏览器前置检查

CI256/source2332f9fb/treeb2057f0的会员26/R6147、admin787/API1457及1581兼容、account安全、production完整HTTPS/第二PG恢复全部通过；api原旧组640通过/1失败（641含6历史源码守卫）。唯一失败C05 Native对账完整账单只含自己fixture，新增会员Native组在同库留下7条应被检测的LOCAL_ONLY；生产全账本判断正确，不能删这些事实或按租户过滤来使测试变绿。新增owned PG runner fdc2efd→rootc0d1035：严格loopback非生产scb_test控制库，随机新库/真实OID与双DB环境，固定只跑会员两文件；CREATE成功才清本库，无FORCE，原控制库/全账本及firstRun前后只读指纹不变。--verify-cleanup固定失败child返回23，CI显式要求23；清理/保全异常为1。作者5项guard通过，root实际9项隔离guard（含新browser4）通过；真实专库26/负向清理仍需新headCI。旧C05测试/业务账本未修改。

独立审查另发现browser会员runner在构造Pool前仅account-security校验loopback，已把同一canonical guard覆盖membership，旧api suite行为不变。新CLI固定--list正例实际抓到spec静态导入官方CLI源的import.meta/TLA被Playwright CJS转换错误；现strict目标guard之后native fileURL动态导入本树编译的原官方maintainPlatformOperator，无第二套授权SQL。真实test collection、全仓type、API build与native ESM模块加载（CLI未触发）通过；不把collection当真实浏览器操作。

CI仍R6 first；随后独立PG26及实际失败清理；单次browser控制库/Chromium安装与新会员两端流程前移，之后原oldPG→NativeHTTP→capture/restart/verify→旧API浏览器相对顺序不变、无少跑/重复。新真实UI如有错误会先发现，避免等整套旧检查才collect。所有runner/workflow/guard/spec增量独立复审无P1/P2，可进入最终新候选；Migration/业务源码未因此改变。新原生会员页、商户资金及生产仍未执行。


## 2026-11-10T18:24:08+08:00 真实截图复核与展示顺序修正

CI257/source094fcf0、测试merge66f5b009、treef845fc2已实际核对同树：会员owned PG26、故意失败23且control保全、新会员真实桌面1/手机1成功，admin787/API1457及兼容1581、账号安全与隔离生产模式完整HTTPS/第二PG恢复成功；旧PG组及其后步骤尚在执行，不能称完整CI通过。root已下载校验artifact13754751292并逐张看4张原图，Web作者也独立对照已确认Figma，无阻断遮挡/全页溢出或价格额度错误。

实际发现专业/商业排序与稿不同，交原Web作者仅按等级做稳定展示排序，金额/真实ID/可售资格/API顺序不改；root补真实浏览器顺序断言，新候选须重新完整CI并下载新截图。手机沿用既有Web壳、顶部信息较长且标签内部横向滚动，不能称原生小程序像素还原；四图只覆盖方案和生效用量，不外推13态/支付弹窗截图。没有用重画稿掩盖差异。

main843085c仅四份M1交接文档，独立复核证实本候选所有旧M1/TMX/历史逐字节保留；root正常merge main为ab80c90（与前f845完全同tree），只解决两个summary相邻段冲突，未覆盖其他3份本轮doc WIP或任何他人工作。新同步保留main843祖先，继续普通PR流程，无force。052隔离执行、生产未执行；新原生会员/真实商户与生产价格发布仍未完成。
