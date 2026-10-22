# 技术架构

设计版本：0.1；更新：2026-10-22；状态：P01、P02、P03-A、P04-A、P05-A、P05-B及P06-A已整合main，DONE / MAIN。真实Web报名、排赛、基础记分／独立确认、有限排名／公开观赛及独立只读包装已验收；完整P03/P04/P05/P06仍有后续范围，原生OBS／CEF与生产未验。依赖版本以实际代码及锁文件为准。

## 1. 结构与实施边界

采用TypeScript模块化单体。P01机构后台四页保留显式Mock模式；P02已接通NestJS、pg参数化SQL和真实PostgreSQL，完成注册／登录／退出、持久会话、机构与赛事授权、草稿创建／读取／编辑及审计。P03-A进一步实现外部领队授权、球队/成员、不可变报名revision、独立审核及freeze。P04-A新增共享场地、可复现单循环、手工排时、冲突检查和一次正式发布。P05-A新增在线球队记分、服务器锚点时钟、fence租约、幂等收据及独立赛果确认。P05-B已交付有限单循环排名与可撤销公开只读API；保险文件、球员本人资料绑定、小程序、可靠离线与直播仍未实现，不能据此宣称完整办赛平台完成。

P06-A已通过[PR #7](https://github.com/xyq-dev/small-city-basketball/pull/7)合并main `f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，DONE / MAIN；最终验收source `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`、tree `2a719b4b3e8fd4f67996144c687f5bbb72902519`。[最终CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)全部成功：372项源码（admin171／API201）、123项独立PG、001→006隔离执行／复跑checksum、真实PG18.6重启与39表完整指纹、12Mock及桌面7＋手机7真实API官方Chromium151.0.7922.34浏览器。正常及故意失败流程只清本次owned子库，控制库保留。 P01–P05-B历史证据保留于[TESTING](TESTING.md)。启动见[开发说明](DEVELOPMENT.md)，当前包装范围见第7节。没有生产部署或生产数据库。

| 部分 | 选择 | 边界 |
|---|---|---|
| 小程序 | Taro + React + TypeScript | 观赛、球队、报名、个人资料 |
| 机构后台 | React + Vite + TypeScript | 赛事四页保留Mock；真实API模式另有球队、报名冻结、排赛及P05-A私有记分工作台，失败不退Mock |
| 现场工作台 | 当前落在apps/admin的机构模式路由 | 在线球队记分、时钟、独立确认；独立scorekeeper应用与专业统计后续建设 |
| 包装页面 | Web透明页面，当前位于apps/admin | P06-A独立只读授权及1920×1080网页包装已验收；原生OBS／CEF连接未验 |
| API | NestJS；P02采用pg参数化SQL | 身份、授权、报名冻结、P04-A正式计划、P05-A记分／时钟／确认已验收；P05-B有限排名／公开投影及P06-A独立包装已验收 |
| 数据 | PostgreSQL | 事务、版本、约束；存储真实业务事实 |
| 文件与视频 | 后续选择对象存储、云直播及点播 | 业务保存文件元数据及授权引用，不将视频存入数据库 |

main包含 `apps/admin`、`apps/api`、`packages/contracts`、根workspace及锁文件、测试和CI。Mock通过 `apps/admin/src/domain` 的内存repository运行并刷新重置；API模式通过会话与HTTP adapter读写真实数据，令牌使用HttpOnly Cookie，不存浏览器脚本可读存储。逐赛事 `permissions.canEditDraft` 来自服务端，客户端不以全局角色代替实际授权。

`apps/scorekeeper`、`apps/miniprogram`、独立`apps/overlay`仍为后续规划；P06-A包装复用apps/admin，不预建空应用。`apps/admin`当前为机构工作台，平台运营后台未实现；`packages/contracts`已承载会话、报名冻结、Court、排赛规则／修订／冲突、统一MatchStatus、记分／租约／收据／私有快照及排名／公开观赛DTO，`packages/ui`待实际复用时建立。P03-A落地于registration服务/控制器、admin registration页面及迁移002；P04-A落地于独立SchedulingService/Controller、admin scheduling页面和HTTP adapter及迁移003。SchedulingService复用ApplicationService的事务、会话、机构与审计helpers，不继承RegistrationService；仍使用现有PostgreSQL连接池，不拆分独立微服务。P05-A的ScoringService/Controller与Registration/Scheduling独立，复用ApplicationService鉴权及事务helpers；前端位于admin scoring页面及HTTP adapter，迁移004保存规则版本、人员、projection、lease/fence、追加事件、收据及不可变确认。

目标逻辑模块为Identity、Organizations、Events、Teams、Registration、Scheduling、Scoring、PublicRead、Broadcast、Entitlements、Audit。其中身份、机构、赛事、球队、Web报名、单循环Scheduling、在线基础Scoring／审计及有限PublicRead已有实现；完整Scheduling、专业Scoring、更多公开读取和Broadcast等仍有后续范围，不能因出现在列表中便视为完成。模块通过明确的应用接口调用；领域模块不依赖 HTTP 控制器、数据库 ORM 或前端组件。统一契约只放 DTO、枚举和公开类型，不打包凭据及数据库内部模型。

## 2. 身份与机构隔离

P02已实现工作人员机构/赛事授权；P03-A已实现外部个人账号及独立TeamAccessGrant、明确目标账号的领队邀请，不创建机构成员。P05-B公开有限投影已整合main并验收，ParticipantLink、球员邀请及附件授权仍是后续目标，没有保险文件服务。

- User 是登录身份；OrganizationMembership 是机构身份；EventStaff 是赛事工作授权，P05-A的MatchStaff是特定比赛授权。平台权限、机构权限和球队身份不能互相替代。
- 工作人员走机构成员及实际赛事分配；P03-A领队通过有效TeamAccessGrant管理本队，撤权后每请求重新校验。邀请消费核验目标账号、令牌、时效、用途及邀请人当前资格，不复活已停用grant，不产生机构后台权限。后续球员本人绑定另行实现；不能把全部机构私有接口都套用工作人员成员守卫。
- P04-A场地写仅OWNER/ADMIN；排赛写按该赛事实际EVENT_MANAGER或OWNER/ADMIN授权，其他已分配工作人员只读。仅有TeamAccessGrant的领队不能访问后台排赛；前端按资源capabilities显示动作，服务端每请求重查。
- P05-A显式SCORER才可实际记分，OWNER/ADMIN不自动获得写分权；MatchStaff可在没有EventStaff时仅获得本场及绑定规则的读取／写入资格，不开放整赛事资料。确认资格还排除历史实际记分者、当前主写者及参赛队当前有效领队；准备、分配、租约和重开本身不算实际记分。撤权与确认每请求及同事务核验，前端capabilities不构成授权。
- 机构范围的私有业务资源都有 `orgId`，全局身份与平台配置单独建模。服务器从可信会话取得操作者，再验证路径机构、资源归属及具体动作权限；不信任客户端传入的角色或 `orgId`。
- 同一事务内的赛事、报名、名单、场次等引用必须属于同一机构。数据库复合外键与应用查询同时约束归属；跨机构访问按不存在处理。
- 首版长期球队档案由机构维护。跨机构参赛通过明确授权导入参赛快照，不开放任意跨租户 JOIN；全平台统一球队身份不是首版前置条件。
- 平台运营人员不能因“平台管理员”身份默认读取身份证、手机号或保单。支持介入需要明确授权、最小字段和操作审计。
- 公开赛程、比分、榜单、球员展示及 OBS 使用独立 DTO 白名单，不直接序列化内部实体。未发布赛事、个人证件和保险材料不得进入公开投影。

## 3. 写入、事件与实时读取

P02已验证赛事CAS及审计原子性；P03-A报名/审核/冻结持Event锁，名单和grant操作按统一Team锁序串行，冻结由服务端获批revision生成并与审计同事务提交。PG/API重启后授权、名单及freeze保留。

P04-A工作稿引用不可变freeze，保存生成种子、完整对阵、规则与当前修订指针；编辑同时检查Event.version和revision.version。发布使用机构排赛互斥锁，并由同机构Court/Team时间排他约束共同防止跨赛事并发重复占用。服务器从已保存工作稿重新核验对阵、时间、权限和版本，同事务创建正式比赛／预约／发布快照、推进SCHEDULED并写审计；检查接口只是只读提示，不是发布凭证。一次发布后计划不可改写，场地改名不覆盖courtName快照。

迁移003已在隔离测试库执行并验证；实际PG/API重启后已发布赛程、Court/Team预约及审计保留，生产库未执行。具体结构和证据见[DATA_MODEL](DATA_MODEL.md)、[TESTING](TESTING.md)及[P04-A交接](handoffs/P04-A.md)。P05-A进一步验证迁移004及真实重启，具体证据见[P05-A交接](handoffs/P05-A.md)；P05-B公开轮询API验收另见第6节，尚无公开推送服务。

普通编辑使用资源 `version` 做乐观并发控制。P05-A实际记分与时钟动作额外要求session／tab／lease绑定及单调fencingToken；每场一个有效主写端，TTL30秒、10秒续约，心跳不增matchVersion。规则保存及准备／首次开始还检查event版本；管理、确认与重开命令不伪造记分租约。首次READY锁定赛事规则，首次LIVE推进赛事RUNNING，单场FINAL不推进整届COMPLETED。

已实施命令事务：当前授权／状态核验 → 按动作检查租约和期望版本 → 追加事件／更新投影及match版本 → 保存receipt／审计；失败全部回滚。授权优先于幂等查重，同ID同内容返回原收据及当前快照，同ID不同内容拒绝。P04正式计划、冻结名单和预约不重写，统一MatchStatus保留READY／LIVE／待确认／FINAL读取。main已交付认证私有轮询及P05-B匿名轮询；SSE、Outbox、worker仍为后续设计；已交付的独立包装轮询见第7节。

事件不直接删除或覆盖；补录／撤销／替换均有理由，重复或跨场撤销被拒绝。确认前重放事件核对投影，保存精确sourceMatchVersion、lastEventSeq、规则和球队基础统计；重开回待确认，旧确认保留，新确认另存。ScoreSnapshot不含lease／session／控制凭据或身份保险材料；球员高级统计未采集，UI显示“未统计”。P05-B榜单仅消费来源核验后的当前有效确认，实现及验收状态见第6节。

## 4. 计时与断网

本节区分P05-A已交付在线能力与后续可靠离线／媒体设计。

P05-A比赛计时保存 `period`、`remainingMs`、`running`、`anchorServerTime`、`clockVersion`；用取锁后的DB clock_timestamp取时间，客户端依据serverTime、锚点及单调elapsed插值。运行时钟在实际PG/API重启后保留并继续计算；归零不自动换节／结束，lease失效不自动暂停。暂停／校时均为可追溯命令，不每秒写库。

P05-A断网停止新写，未知提交仅在当前页面内存保留原envelope；超时／5xx／断开不等于失败，先读receipt与当前snapshot，404仍待核对。只有原控制／版本／权限仍有效才可原包重发，否则人工核对恢复，不自动换ID。身份及控制不用localStorage/sessionStorage，页面销毁不承诺未确认命令恢复；重进读取权威状态并重新取得控制。可靠持久离线队列、自动补交和跨端冲突恢复尚未实现，不能把这些目标当成交付。

视频后续设计须区分比赛倒计时、事件服务器时间、设备采集时间和录像媒体时间；媒体session及PTS／偏移映射尚未接入，不能把比赛时钟等同录像锚点。

## 5. 安全与运行边界

会话、动作对应的工作人员或参赛者授权、机构与赛事资源归属每次请求验证，包含幂等重放。文件上传走受控授权，下载重新鉴权；敏感材料使用独立访问策略。日志不记录密钥、完整身份证、保单内容和直播推流密钥。

本地、测试、生产分离。可观测项至少包含请求 ID、事件 ID、比赛版本、同步延迟、失败队列、授权拒绝和更正记录；运行告警阈值在上线准备阶段确认。付款、退款、套餐扣量和 Migration 必须经过各自设计与授权，首版不因 UI 出现入口就自动启用。

关联：[数据模型](DATA_MODEL.md)、[API 契约](API_CONTRACTS.md)、[OBS 接入](OBS_INTEGRATION.md)。


## P05-A交付与后续边界

P05-A已DONE / MAIN；[CI39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)验收212项源码检查、88独立PG、真实PG18.6重启及12Mock＋10API浏览器。Migration004只在隔离测试库执行／复跑；无生产部署或生产DB。私有snapshot为后续投影基础，该阶段不包含排名、公开观赛、专业统计、可靠离线或OBS；其中有限排名／公开观赛现由P05-B另行交付；全P05仍未结束。完整行为与失败历史见[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md)及[TESTING](TESTING.md)。

## 6. P05-B已交付与公开读取边界

P05-B已随PR #6整合main。[最终CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)在P05-B验收source d9161e96通过302项源码／组件／HTTP（admin147＋API155）、106项独立PG、12Mock及12API桌面／手机浏览器、格式／完整strict／两端构建，以及真实PG18.6重启后的37表指纹与业务比较。迁移001→005隔离执行／复跑成功；正常浏览器子库清理和故意失败子进程的owned数据库清理均有真实验证。官方浏览器为Chromium151.0.7922.34。独立SQL/API/UI/PG审查CLEAR，最终source自动CodeReview completed且无finding，security review未运行；前三轮失败／取消与修复见[TESTING](TESTING.md)。

独立StandingsService、纯standings-domain、私有StandingsController及匿名PublicViewingController共同实现P05-B。StandingsService浅复用ApplicationService的Pool、事务、session/org与audit helpers，不继承ScoringService，也不改变记分状态机、授权、时钟或P04固定计划。规则草稿追加版本、单独显式发布后永久锁定；纯函数只支持2–32队单循环、显式0–1000积分及有序同分项、共享1,1,3和零场rank=null。全部场次确认仍不自动COMPLETED整届或宣布唯一冠军。

可变赛果证明用一条批量SQL同时读全部match/state、当前不可变confirmation、最后event、receipt和scoring rules，LEFT JOIN保留坏FINAL供显式拒绝；不逐场调用ScoringService，不建缓存／outbox worker。FINAL要求版本、指针、事件／收据、规则、总数／按节合计及终局暂停零时钟一致。staff仅修改当前运行版本仍保留有效确认且不改变业务sourceHash；重开整场撤出，重确认只计最新一次。终局校验的三个缺口已在独立审查中修复并有源码反例。

005保存排名规则、可撤销public publication及全量公开match映射。公开ID与每次publication的teamKey随机独立，公开DTO逐层白名单重建，包含有限球队统计和raw clock，不含内部ID、名单、确认人、事件／receipt、session或控制凭据。未准备值为null，不能伪造已采集0；匿名Cookie不参与权限，公开GET没有业务写入副作用。

规则／公开写按actor/session→org/member→Event UPDATE→publication/映射，与Event版本及audit同事务。匿名解析公开身份后按org SHARE→Event SHARE→publication SHARE重查有效性；撤销后的新读取404，重新启用必须全新公开身份。DISABLE不计算损坏榜单，保证坏来源不会阻止撤销；不占org_schedule_mutex。单场SCORER分配不授予私有整届排名管理权。

页面合同为私有`/standings`、`/events/{eventId}/standings`和匿名`/watch/{publicEventId}`及其matches页。viewing页面按需加载；Runtime在私人会话初始化前分流，public fetch为credentials:omit，使用独立路由且不嵌套BrowserRouter；主办后台／Mock／邀请fragment流程保留。公开页面轮询，404清旧内容，离线／读取失败标陈旧，世代及卸载保护避免旧链接响应覆盖新页；不承诺零延迟撤屏、SSE、CDN／DDoS容量或生产部署。精确DTO／错误见[API第9节](API_CONTRACTS.md)，表／锁／005hash见[数据模型第10节](DATA_MODEL.md)。

## 7. P06-A已交付与独立包装边界（DONE / MAIN）

P06-A已通过[PR #7](https://github.com/xyq-dev/small-city-basketball/pull/7)合并main `f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，DONE / MAIN；最终验收source `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`、tree `2a719b4b3e8fd4f67996144c687f5bbb72902519`。[最终CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)全部成功：372项源码（admin171／API201）、123项独立PG、001→006隔离执行／复跑checksum、真实PG18.6重启与39表完整指纹、12Mock及桌面7＋手机7真实API官方Chromium151.0.7922.34浏览器。正常及故意失败流程只清本次owned子库，控制库保留。 API/SQL/UI/PG及FK补丁独立审查CLEAR；另有native153的19状态合成布局／三张PNG。源码、真实CI和原生OBS验证分别记录，完整P06与生产尚未完成。

OverlayService浅复用ApplicationService的连接池、当前身份／机构授权、事务与审计helpers，与ScoringService、StandingsService独立；OverlayController提供私有管理两入口，OverlaySourceController提供bootstrap和snapshot。没有微服务、SSE或新依赖。单场来源用一条SQL取match/state、当前confirmation、最后event／receipt及规则后复用confirmedResult证明，不依赖排名规则或public publication，不改变原记分状态机、比赛版本、lease或正式计划；媒体PTS尚未接入。

管理者须为当前有效机构成员，且为OWNER/ADMIN或本赛事实际EVENT_MANAGER／STREAMER；其他实际event staff仅可读有限预览及Grant元数据。global STREAMER、单场SCORER／RESULT_REVIEWER或球队grant都不替代赛事授权。管理写从入口持Event UPDATE，随后eventstaff与Grant锁，使用Event CAS、必要Grant CAS，与版本／审计同事务，不升级Event SHARE或占排赛mutex。Grant签发后独立于签发者私人登录状态；当前管理资格仍每次重查。

独立源先解析不透明overlayId，按org SHARE→Event SHARE→Grant SHARE→overlaySession SHARE取锁并以锁后DB时间验证。Grant与专用session的截止由复合FK精确绑定；可重复使用secret bootstrap，有效同Grant Cookie复用，正确secret可恢复单一无效／跨Grant Cookie，无私人scb.sid回退。session INSERT可能等待正式match FK锁，独立审查已补INSERT后单次MATERIALIZED clock_timestamp精确重检共同截止，过期404且整事务回滚，不能返回迟到Cookie。

浏览器源URL采用`/overlay/{overlayId}#token=…`，首次layout effect立即清fragment并保留history.state/path/query，secret仅本次内存。Runtime在私人会话及邀请处理前分流；专用host-only HttpOnly／Strict Cookie的Path限定单源API，生产Secure。Path不是同源脚本安全边界，同源可信部署仍是前提。DTO逐层重建，无内部资源ID、名单、人员、确认人、事件／收据或控制凭据；坏FINAL源严格409，私有preview:null＋previewError仍可管理、撤销且不回滚成功授权命令。

管理页索引复用现有可见event列表→正式matches全分页，不使用含match-only用户的scoring-matches。弹框固定审阅版本；未知结果先GET核对，secret丢失需显式轮换，无盲目重签。源和预览共用透明1920×1080 renderer；源每次完成后2秒串行读取，单请求8秒超时，只有完整有效snapshot刷新30秒陈旧期限；请求发送performance锚扣完整RTT计算硬截止，已知截止只提前。404／到期终止且拒绝迟到200，409清屏继续核对，卸载清理请求／timer／透明模式class。原生OBS／CEF透明合成、保存源及隐藏／刷新仍待客户端另验。精确合同见[API第10节](API_CONTRACTS.md)，数据库与验证边界见[DATA_MODEL](DATA_MODEL.md)、[TESTING](TESTING.md)。


### P06-A两轮成功CI与恢复来源

首CI39756976748在远端source7ba9d01bb46d8c4b7a5ce72081aef50719d05539（tree52f2681a727b9a5ea4944c6019a8f0eaa0cda8cd）也全部成功；后续15份Markdown只修可达恢复点及记录，没有业务或Migration变化。最终CI再次全部成功后合并PR7。首head文档P2已resolved／outdated，最终addeb自动CodeReview completed且无finding（comment6337630278），security未运行。恢复使用上述main合并点或最终远端source；本地19d5801仅作历史来源，不是fresh checkout恢复入口。两轮run／job与边界见[TESTING](TESTING.md)。原生OBS／CEF、生产与备份恢复仍未验收。
