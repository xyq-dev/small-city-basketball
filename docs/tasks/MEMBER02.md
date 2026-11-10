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
