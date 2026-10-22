# OBS 与直播接入设计

设计版本：0.1；更新：2026-10-22；状态：OBS接口与交互规划，未连接OBS、未采购或配置云直播。P05-B有限公开投影及Web已合并main并验收，不等于OBS包装交付。P06-A透明源、独立授权及管理UI已在本地feature整合，尚未真实PG／API浏览器验收或合并main，也没有原生OBS／CEF测试。既有 UI 图片里的直播入口仅为概念。

## 1. 首选接入路径

记分系统提交事件后生成只读投影 → 包装页面实时读取 → OBS 浏览器源加载包装页面，与摄像机画面合成 → OBS 向选定云直播服务推流 → 小程序使用已获授权的播放地址观赛。OBS 与云直播断开都不能阻断比赛记录。

P06-A首卡只提供双方文字队名、基础比分、节次与计时的1920×1080透明比分条，精确范围见[P06-A任务卡](tasks/P06-A.md)。队徽、赛前名单和冠名／赞助模板属于后续任务。球员技术统计只展示已采集字段；球员集锦依赖可靠的事件归属及媒体对齐，后续实现。模板比例至少预留横屏 16:9；竖屏与不同安全区在独立模板任务验收，不默认直接拉伸。

## 2. 直播工作台

| 区域 | 设计要求 |
|---|---|
| 比赛绑定 | 明确机构、赛事、场次与双方；切换比赛需确认，不沿用上一场授权 |
| 包装地址 | 首卡签发固定TTL本场地址，secret仅成功时可复制；轮换生成新身份，撤销永久失效；不提供原身份续期 |
| 模板与预览 | 首卡固定透明比分条与同renderer缩放预览；队徽、可编辑布局、名单与赞助排期另卡 |
| 数据状态 | 显示投影版本、最后更新时间、陈旧/断连提示，与现场记分同步状态分开 |
| 推流设置 | 云服务接入后才展示地址、密钥和流状态；密钥仅授权人员可见，默认遮罩 |
| 内容交付 | 后续展示录像、集锦任务、视频用量和失败重试；不能把正在直播等同录制已成功 |

没有 obs-websocket 连接时，系统只知道包装会话和云端流状态，不能把“包装网页已加载”显示为“OBS 已连接”，也不能确认真实摄像机画面或推流质量。预览、包装源、OBS 控制连接、云端推流、录像是不同状态。

## 3. 包装数据与授权

P06-A包装使用独立overlayId及专用只读session，包含双方文字队名、基础比分／节次／原始时钟、matchVersion、serverTime和固定模板。它不依赖P05-B公开publication或排名锁定；授权赞助素材另卡。流中不出现身份证、手机号、保险材料、内部工作人员列表、推流密钥或修改接口。

以下OverlayGrant已在P06-A本地实现、待真实验收，不是P05-B公开观赛链接。每个OverlayGrant在服务端绑定机构、赛事、正式比赛、固定模板、硬截止及撤销状态。它只能读取该场有限投影；P06-A的TTL显式必填且不能续长原身份，轮换时撤销旧身份并创建新身份；它不是永久机构令牌。当前每次读取均重查授权，轮换／撤销后新读取404；无实时消息通道，未来加入推送时也必须持续检查撤销，不能沿用旧连接授权。

P06-A源码将引导secret放URL fragment，首次进入即清除fragment并仅本次内存保留；通过同源bootstrap换取专用HttpOnly Cookie，有效secret可重复使用以支持保存源URL后重载。当前已做源码及合成HTTP检查，真实API浏览器与原生OBS重载仍待验收。日志、错误上报和截图不能记录令牌。包装页面不引用能带出授权信息的第三方追踪脚本。

P06-A断连立刻标陈旧，距离最后完整快照超过30秒或达到Grant硬截止便清除球队名／比分；404／到期终止且迟到200不能复活。恢复后先拉当前完整版本；计时使用权威锚点校正。OBS 隐藏/重新加载浏览器源不能让比分归零或重放旧事件。

## 4. 媒体时间与远控

BroadcastSession 和录制 session 独立记录，直播重启/切源需要新的媒体锚点。MediaAnchor 保存匹配版本、比赛倒计时/服务器时间与媒体 PTS/偏移的对应关系及误差。补录和离线事件不能仅凭写入时间直接裁剪视频；不可靠映射应标记待人工校准。

obs-websocket 的切场、录制和推流控制放在后续阶段。云平台不能直接访问用户电脑的 localhost；如需要远控，另行设计获授权的本地连接程序或受控连接通道，不要求直播员把 OBS 控制端口裸露公网。远控指令有身份、设备和赛事范围限制；停推/停录/切场需防误触并有日志。

## 5. P06 验收最低项

- 记分、撤销、更正和校时后，包装与权威快照在约定延迟目标内一致；延迟预算在实现任务中量化。
- 源隐藏、刷新、断网重连和 OBS 重启后恢复正确版本；OBS 停止时工作台仍可记分。
- 令牌越场、越机构、过期、撤销和轮换用例均通过，公开投影不含私密字段。
- 不以包装页面加载状态冒充 OBS 控制连接或云端推流状态。
- 直播重新开始后录像锚点正确分段；未开通视频服务时不生成虚假录像、集锦或用量。

商业范围：软件办赛服务与直播/视频用量分别定价和计量。云厂商、套餐价格、视频保留期及分发成本尚待选定，不在 P01 引入真实扣费。


## 6. P05-A已交付的先行契约

P05-A已通过PR5/CI39743710053验收，其私有ScoreSnapshot统一规则、双方冻结展示名、球队基础统计、matchVersion、clockVersion、anchorServerTime和serverTime，并明确未采集球员统计。P06包装应从受限投影消费这些权威字段；不能把含工作人员/租约的Workbench DTO直接暴露给OBS。P05-B已交付独立公开ID、匿名有限字段及可撤销公开观赛，并经真实PG／浏览器验收；独立OverlayGrant／session及固定比分条已在P06-A本地实施，仍待真实验收；其余OBS模板及媒体会话后续实施。本段是接入约束，不表示OBS或视频服务已连接。

## 7. P05-B已交付的有限公开投影参考

P05-B经[PR #6](https://github.com/xyq-dev/small-city-basketball/pull/6)合并main `bd38318fdfdbaeb9cfee1033c0d025e79c6cc797`，验收代码`d9161e965b367ed8cb445482d57759bd34e89629`；[最终CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)全部通过302源码、106真实PG、37表实际PG18.6重启、12Mock＋12API官方Chromium151.0.7922.34流程及正常／失败子库清理。迁移001→005仅在隔离测试库执行与复跑校验，没有生产部署；历史失败见[P05-B交接](handoffs/P05-B.md)。以下仅说明P06可参考的字段和隔离规则，不表示已运行OBS联调。

| 已交付只读接口 | 允许公开的数据 | 对后续包装的意义 |
|---|---|---|
| `GET /v1/public/events/:publicEventId` | 赛事声明信息、排名规则摘要、有效确认数／总场次、serverTime | 可参考赛事标题及数据状态；不推断已连接OBS或正在直播 |
| 同路径 `/schedule`、`/standings` | 正式时间／场地／轮次、双方展示名、基础比分／确认状态；显式规则汇总及共享名次 | 只能展示允许的球队数据，排名暂列／共享不推导唯一冠军 |
| 同路径 `/matches/:publicMatchId` | 基础比分、全场／分节得分犯规暂停、绑定规则摘要、原始时钟锚点与serverTime、采集标记 | P06可沿用语义设计受限包装快照；球员专业统计、队徽／赞助素材和媒体锚点并非本卡已提供字段 |

主办方先发布正式赛程、锁定排名规则，再显式启用匿名链接；读取无需登录或机构session，客户端credentials: omit。publicEventId及逐场publicMatchId为独立随机标识，teamKey仅关联本次公开发布，不暴露内部org／event／match／entry／team／user ID。白名单也不含名单、人员、原始事件／收据、lease／fence或任何写分凭据；不能将私有Workbench DTO当包装契约。

撤销后新读取统一404，再启用生成全部新标识，原链接永不复活。此授权覆盖主办方选择公开的赛事数据，**不替代按场、模板／字段及有效期约束的OverlayGrant**。P06-A已本地实施独立包装地址及授权轮换／撤销，仍待真实验收；实时通道及后续包装扩展另卡，不得把P05-B公开地址当成已获授权的OBS控制或推流凭据。

未准备的score／clock等字段为null；初始化0与“尚未开赛”须同时表达。运行时钟是原始remainingMs、running、anchorServerTime、clockVersion和serverTime，消费者按权威锚点扣减一次，不能二次扣除服务器已耗时。重开标REQUIRES_RECONFIRMATION，原确认退出当前排名；只读比赛页不会因此获得更正或确认权。

当前Web设计是轮询，断网可保留带陈旧提示的上次快照，404须清空，不能承诺撤销后离线／已打开页面瞬间消失。P06若引入实时连接，仍需验证持续授权和撤销后停止后续消息；比分页可加载不证明OBS可用、同步延迟已达标、云流成功或录像存在。专业统计、可靠离线写分、OBS联调、视频与媒体时间映射均不因P05-B而完成。


## 8. P06-A本地实施范围及待验收条件

维护读取基线为远端7ba9d01，main文档基线ca68dea仍只有P05-B已交付；当前完整远端source为7ba9d01，331d2c3为早期DTO。当前本卡为REVIEW，PR7及首CI已建立，尚未MAIN整合。精确范围见[任务卡](tasks/P06-A.md)，进度见[交接](handoffs/P06-A.md)，布局见[证据](evidence/P06-A/README.md)。

| 本地已实施入口 | 行为与边界 |
|---|---|
| 私有 `/broadcast`、`/matches/:matchId/overlay` | 正式比赛选择、同renderer缩放预览、有限授权元数据与管理；不借用公开链接或记分员身份 |
| `GET /v1/orgs/:orgId/matches/:matchId/overlay` | preview或null＋有限previewError、fresh赛事版本、currentGrant、最近20条已撤销history及能力；不返回secret |
| `POST /v1/orgs/:orgId/matches/:matchId/overlay-commands` | ISSUE／ROTATE／REVOKE，赛事CAS及必要Grant版本；仅前两者成功响应一次性credential，不提供读取旧secret接口 |
| `POST /v1/overlays/:overlayId/bootstrap` | 先核验secret，再复用同Grant有效Cookie或创建专用session；200只返回overlayId／expiresAt／serverTime，session仅Set-Cookie |
| `GET /v1/overlays/:overlayId/snapshot` | 仅认专用Cookie，每次检查机构、Grant与硬截止，返回有限权威投影；GET不写计数或续期 |
| `/overlay/:overlayId#token=<secret>` | 固定SCOREBAR_1080P_V1、1920×1080透明画布和下三分之一比分条；独立于私人Runtime及邀请fragment |

授权由当前有效机构OWNER／ADMIN或本赛事实际EVENT_MANAGER／STREAMER管理，全局STREAMER或仅MatchStaff不能管理；其他实际赛事工作人员只读有限预览及元数据。Grant属于赛事，签发者退出／个人撤权不自动撤销，当前管理者须主动处理，机构停用则停止全部读取。公开publication及排名规则既不授予也不阻断包装授权。

TTL必填1–10080整数分钟、按DB时间计算，不续长原身份。每场唯一未撤销Grant，current包含已到期未撤销记录；ISSUE遇到这种记录，事务内以SUPERSEDED_AFTER_EXPIRY关闭后创建新身份。ROTATE／REVOKE须1–200字符理由及精确版本，旧身份永不复活。history仅最近20条已撤销记录，包含过期替代，按创建时间／overlayId降序；historyLimit=20，historyTruncated说明更早记录未列出，不提供假游标。

secret与只读session仅hash存库。secret只在成功签发／轮换时交付一次，UI用password输入遮罩、内存复制；离页无法找回，丢失后显式轮换。有效secret可重复bootstrap，正确secret必须先于Cookie复用核验；单一无效／跨Grant Cookie可凭正确secret恢复，重复／歧义Cookie404，私人scb.sid不提供回退身份。专用Cookie为host-only、HttpOnly、SameSite=Strict、生产Secure，Path精确到本源接口；Path不是同源XSS隔离。session截止在DDL等于Grant截止；新session INSERT可能等待正式比赛外键，等待后再次取单一DB时间精确复核两者截止，过期404回滚，成功metadata和Cookie用fresh时间，绝不通过刷新续期。

有限投影逐层白名单构造：赛事名、双方文字队名、场次状态与版本、基础得分／犯规／暂停／分节、绑定规则摘要、原始时钟及serverTime、采集标记和确认状态。不含内部机构／赛事／比赛／球队／报名／用户ID、名单、工作人员、原始事件／收据、lease／fence或写凭据。未准备score／totals／periods／rules／clock为null；READY的0明确尚未开赛。FINAL复用有效确认来源证明，单场一次SQL快照读取；坏来源独立snapshot返回409，管理previewError不能使授权元数据读取或撤销事务回滚。管理仅增加Event版本／审计，不改Match版本、记分投影或lease。

源每2秒串行读取，8秒超时，无重叠请求。断网立刻标陈旧；最后完整快照30秒未成功更新或Grant硬截止到达时清除队名／比分，bootstrap不能重置陈旧计时。截止按请求发送时performance锚保守扣完整RTT，同Grant已知截止只可提前；404／到期终止并丢弃迟到200，409清屏后仍可恢复读取。不能承诺离线瞬间获知撤销。时钟沿原raw anchor只扣一次，不因源断开暂停记分。

已执行：本地372源码（admin171＋API201）、格式／strict／两端build、nativeChromium153的12Mock；API／UI／PG用例及006独立静态CLEAR，外键等待补丁delta CLEAR。19种合成HTTP布局、3张PNG检查通过，透明PNG只证明Chromium渲染，非OBS／CEF合成。

尚未执行：006真实PG；新增17项PG源码保留原106，预计123；39表实际重启、14API浏览器及完整CI待运行。006 SHA256为`94a54d6ae997774fd9b511dd39f5d4e1596b71c97384f2162e5c1dd8a7a39be6`，不能把静态CLEAR写成迁移已执行。原生OBS／CEF透明合成、保存源后重启、隐藏卸载与激活刷新均须真实客户端另验。本卡没有obs-websocket、推流、录像、视频云服务或生产部署，完整P05／P06仍未完成。


### P06-A远端恢复点与首CI结果

首CI39756976748在远端source7ba9d01bb46d8c4b7a5ce72081aef50719d05539（tree52f2681a727b9a5ea4944c6019a8f0eaa0cda8cd）全部成功：372源码（admin171/API201）、123独立PG（原106＋17）、12Mock＋桌面7／手机7真实API、格式／完整strict／build、001→006与checksum、实际PG18.6重启及39表完整指纹、正常及故意失败子库清理。官方Chromium151.0.7922.34。 admin119751331489、api119751331716最终日志均已读取。完整可恢复分支为`feat/P06-overlay`，[PR7](https://github.com/xyq-dev/small-city-basketball/pull/7)。此前19d5801仅是未同步的本地来源，不能充当fresh checkout恢复入口，当前文档已统一指向实际可访问远端source。上文“未执行”保留提交首CI前的检查点；最新以本段及交接为准。仅文档恢复点修正的下一候选仍需完整CI后合并，当前REVIEW／BRANCH_ONLY、尚未MAIN。首head自动CodeReview的文档P2已本地修复待push／resolve，security未运行。原生OBS／CEF、生产与备份恢复未验收。
