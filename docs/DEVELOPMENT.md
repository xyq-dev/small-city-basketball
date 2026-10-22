# 本地开发与验证

更新：2026-10-22（Asia/Shanghai）。适用范围：已整合的P01 Mock、P02真实API、P03-A Web报名、P04-A单循环排赛／一次发布、P05-A基础在线记分／独立确认／私有快照及P05-B有限单循环排名／可撤销公开观赛。上述子卡为DONE / MAIN，[PR #6](https://github.com/xyq-dev/small-city-basketball/pull/6)合并为 `bd38318fdfdbaeb9cfee1033c0d025e79c6cc797`；验收source `d9161e965b367ed8cb445482d57759bd34e89629`、tree `554284a604f3b0027d5b0eedc7dbbee20eab3119`。后续开工仍核验最新HEAD和dirty；历史基线与证据见[TESTING](TESTING.md)。

[最终CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)已全部通过：302项源码（admin147／API155）、106项独立PG、001→005隔离执行／复跑、37表实际PG18.6重启、12Mock及12真实API官方Chromium151.0.7922.34浏览器。浏览器每project使用独立随机测试子库，正常／故意失败流程均只清理本次拥有的库，保留base；前三轮失败／取消和修复见[TESTING](TESTING.md)。没有生产部署或生产DB。

P06-A完整源码现已本地整合至`19d5801b91bdbb8af0df0403c99c331b41800629`；本地372源码（admin171／API201）、strict／构建／格式、native153的12Mock与19状态合成布局通过。远端仅DTO检查点`331d2c3758472ec8f739729bff4d6a4212ad4cb4`，main文档仍为ca68dea、业务仍为P05-B；尚无PR7、P06真实PG／重启／API浏览器验收或MAIN交付。P06调试见第7节，不能仅拉main或DTO就宣称可运行本卡。

## 1. 获取与安装

新目录可执行：

```sh
git clone https://github.com/xyq-dev/small-city-basketball.git
cd small-city-basketball
npm ci
```

已有checkout先核验目录、远端、分支、HEAD、未提交改动，按任务要求更新，不重复克隆或强制覆盖。私有仓库使用已授权GitHub身份，不把凭据写入URL。使用Node24；package.json下限为22.12.0，不代表已逐一验证全部版本。

## 2. 选择数据模式

| 模式 | 用途 | 保存行为 |
|---|---|---|
| Mock | P01演示和界面验证，不需要数据库 | 内存数据，刷新重置；不采集真实人员资料 |
| API | P02身份／机构／赛事、P03-A球队／报名／冻结、P04-A共享场地／排赛／发布及P05-A在线记分／独立确认、P05-B有限排名／公开观赛 | 真实PostgreSQL；刷新和重启后仍可读取已提交数据 |

无.env且未设置VITE_DATA_MODE时使用Mock，执行 `npm run dev` 即可。已有.env时先确认模式；设为 `VITE_DATA_MODE=mock` 才是明确的演示环境。API模式不能因连接失败、未授权或读取后页失败而退回Mock。

## 3. 启动真实API模式

复制根 `.env.example` 为 `.env`，替换密码占位值。DATABASE_URL中的密码须与POSTGRES_PASSWORD一致，DEV_SEED_PASSWORD仅用于可选开发seed；不要提交.env。

准备支持btree_gist的PostgreSQL，并为迁移身份提供创建该扩展的必要权限；003使用此扩展实施资源时间排他约束，不可跳过。也可使用仓库Compose配置：

```sh
docker compose up -d postgres
```

确认数据库healthy后，在项目根目录执行：

```sh
npm run db:migrate
npm run dev:api
```

另一个终端执行：

```sh
npm run dev:admin
```

.env默认 `VITE_DATA_MODE=api`，API为 `127.0.0.1:3000`，Web为 `127.0.0.1:5173`。APP_ORIGIN必须精确匹配浏览器origin；改API端口时同步API_PROXY_TARGET。数据库凭据仅供服务端使用，不进入前端包。Compose是本地运行选项；已执行的真实数据库验收来自CI隔离PostgreSQL18.6，不把当前容器未执行的Compose命令写成已通过。

已交付P05-B main的`npm run db:migrate`按001→005应用；五条均在最终CI隔离执行及复跑校验，实际PG18.6重启成功。runner核验checksum并跳过已应用文件，API启动不自动迁移。不修改已应用的001–005；生产尚未执行。005 hash见[DATA_MODEL第10节](DATA_MODEL.md)。

在Web登录页可注册机构账号，进入空赛事空间；“球队领队？创建个人账号”只建立User和Session，不创建机构或工作人员。个人页面显示本人ID，机构OWNER/ADMIN用该existingUserId签发球队邀请；领队登录目标账号后接受，并刷新独立teamContexts。邮箱尚未验证，不能用email自动认领邀请；微信登录和密码重置未实现。

可选执行 `npm run db:seed`，必须显式设置DEV_SEED_PASSWORD；只使用合成资料，seed幂等且不清库、不重置已有密码。API启动不自动迁移或seed。

## 4. 主要页面

| 页面 | 路由 | 行为 |
|---|---|---|
| 工作总览 | `/` | 当前模式及机构的赛事入口 |
| 赛事列表 | `/events` | 名称/状态筛选、清空及详情导航 |
| 创建赛事 | `/events/new` | 校验后创建DRAFT；API权限由服务端确认 |
| 赛事详情 | `/events/{id}` | 读取草稿及按权限编辑；版本冲突有反馈 |
| 球队与球员 | `/teams`、`/teams/{teamId}` | 按授权维护长期成员、签发邀请和停用领队；球队模式仅本队详情 |
| 报名审核 | `/registration`、`/events/{eventId}/registration` | 工作人员配置报名规则、开关报名、查看审核及冻结结果 |
| 我的球队 | `/my-team` | 独立领队上下文读取开放赛事及本队既有报名 |
| 报名名单 | `/entries/{entryId}` | 按capabilities编辑、提交、独立审核或只读；每次保存产生新revision |
| 排赛入口／共享场地 | `/scheduling`、`/courts` | 工作人员按授权进入；OWNER/ADMIN管理canonical Court |
| 赛事排赛／历史稿 | `/events/{eventId}/scheduling`、其`/history/{revisionId}` | 配置显式policy、生成／重抽、全量分配、定位冲突、一次发布及读取正式场次；旧稿只读 |
| 记分与赛果 | `/scoring` | 按当前机构及实际赛事／场次权限列出可见比赛 |
| 赛事记分规则 | `/events/{eventId}/scoring` | 管理者显式配置规则，首次准备比赛后锁定；仅有场次权限者不进入此页 |
| 场次记分工作台 | `/matches/{matchId}/scoring` | 按capabilities分配、准备、取得控制、在线记分／计时、修正及独立确认；可读不等于可写 |
| 排名与公开观赛管理 | `/standings`、`/events/{eventId}/standings` | 有限单循环规则、预览／发布及主动启用／撤销公开；不支持赛制显示说明卡 |
| 匿名观赛 | `/watch/{publicEventId}`、其`/matches/{publicMatchId}` | 有效公开身份只读，不初始化私有会话或请求机构资料 |

API模式的注册、登录、退出、机构／球队切换和会话恢复在运行外壳中处理。用户主动切换工作空间到对应首页，后台刷新授权保留合法详情路径；切队不会带入上一队资料。邀请链接仅含fragment凭据，首次及hashchange读取后立即清除，不写localStorage/sessionStorage。Mock模式不接P03/P04/P05真实服务，其示例赛事和刷新重置不能混入真实结果。

推荐合成数据验证顺序：机构建DRAFT赛事并保存报名规则→领队接受本队邀请、维护长期成员→机构开放报名→领队建报名并保存／提交名单→独立工作人员审核→关闭报名→至少两队获批且无待审／待修改时冻结。负责人若同时是该队当前领队或最近提交人，也不能自审。冻结后仍为REGISTRATION_CLOSED。P04-A可继续：建立共享Court→为2–32队ROUND_ROBIN填写占用时长／休息／本地日期间隔和带明确偏移的可用窗口→生成当前稿→全量分配→校验与修正→一次发布进入SCHEDULED。重抽需原因、旧稿保留；publish重新检查当前正式占用，发布后不能编辑或改期。基础在线记分可按下述P05-A流程继续；保险附件、OBS和视频未接入。

### P05-A在线记分流程与恢复

1. 完成P04正式发布后，由管理者在赛事记分页明确填写常规节数、节长、允许得分分值及平分／加时策略，不默认FIBA；排赛的场地占用分钟数不是比赛节长。球队犯规与暂停只记当节／全场次数，不暗设剩余额度；未采集的球员统计仍为“未统计”。
2. 管理者为具体比赛分配有效机构成员担任SCORER或RESULT_REVIEWER。SCORER可仅获本场权限而没有EventStaff；OWNER/ADMIN也不会自动获得写分权限。管理员可停用已有但成员／用户已失效的场次分配；不能据此新建无效授权。
3. 管理者准备比赛，绑定并锁定赛事记分规则，初始化第1节暂停时钟。已分配SCORER取得本页控制后开始比赛；START进入LIVE仍保持暂停，只有显式启动时钟才走时。首次开赛使赛事进入RUNNING，不自动完成整个赛事。
4. 记分、犯规、暂停及有理由的统计补录／撤销／替换，均以成功ack后的服务器快照为准，不乐观加分；原事件不删除。换节、进入加时和结束均要求有效剩余为0且已显式暂停；OVERTIME平分不能结束。
5. 结束只进入PENDING_CONFIRMATION。确认者必须有当前管理／结果审核权限，且不是本场任何历史实际记分／计时／开始／结束／修正人员、当前主写者或任一参赛队有效领队，OWNER无例外。确认固定的待确认版本，有新变化就重新读取；FINAL后只可由管理者填写理由重开，再作有理由的统计修正并独立重确认。旧确认保留；本卡不允许回LIVE补加时，若OVERTIME更正成平分则保持待处理，不能伪造赢家。

主写租约TTL30秒、每10秒续约，绑定会话、每tab独立clientInstanceId、leaseId和单调fence。控制信息只在本页内存中保存，不落localStorage/sessionStorage。刷新或重新打开页面会生成新实例，先读取权威状态，等待旧租约失效或由持有页成功释放后再取得控制；过期控制不能靠续约或旧释放请求复活。租约失效、页面断网或服务重启不会自动暂停正在运行的真实比赛时钟。

快照中的raw clock保存锚点时的remainingMs及anchorServerTime；running时只扣一次服务器估计当前时间与该锚点的差，最低为0，暂停时保持remainingMs。不要把已扣时的数值再配旧锚点重复扣时。服务使用取锁后的DB时间，capturedAt不决定比赛时钟或事件顺序；刷新、重启及读取快照都不将时钟归零，剩余为0也不自动FINAL。

超时、5xx或连接断开可能发生在命令已提交之后。停止新写并保留本页原envelope与commandId，先用原身份查询命令收据及当前快照；原receipt.appliedVersion与当前snapshot.version可以不同，已接受命令不能再当新加分应用。查无收据也不证明永远失败；继续核对，若需重发，必须保持同一完整命令及有效的原控制／版本条件，不换ID、不自动重算基线或重放。授权、fence或基线变化时先人工核对再恢复操作。页面销毁、进程崩溃或清理浏览器存储不承诺恢复未持久命令；本卡没有可靠离线队列，断网期间不继续写分。

私有快照及事件／确认历史按当前授权读取，完整翻页失败会整体报错。快照不含主写凭据；P05-A不含匿名观赛或排名，P05-B已交付扩展见下文，尚无SSE/outbox或OBS接入。详细命令及守卫见[P05-A任务卡](tasks/P05-A.md)和[API契约](API_CONTRACTS.md)。

### P05-B排名与公开观赛流程（DONE / MAIN）

main中的私有入口为`/standings`及`/events/{eventId}/standings`；匿名入口为`/watch/{publicEventId}`及`/watch/{publicEventId}/matches/{publicMatchId}`。只支持2–32队单循环正式赛程；分组／淘汰入口显示未支持说明，不能进入排名管理。用合成账号分别承担领队提交、独立工作人员审核、场次记分、独立结果确认；签发或拥有账号不会免除自审限制。

1. 有赛事管理权者显式填win/loss/draw积分（各0–1000）和有序同分项（可为空），保存草稿后再单独发布当前规则；发布永久锁定。预览标草稿，不把零确认时rank=null显示成冠军。
2. 主办方主动ENABLE公开观赛后才分享随机publicEventId链接。仅有MatchStaff的人员不能读取私有整届排名；公开链接仅提供有限只读投影，不赋予后台身份或写分权。
3. 匿名页面在Runtime入口独立分流，不先请求auth/session或org，public fetch为credentials:omit；公开页与工作台之间可整页导航，不复用私人Cookie错误处理，也不破坏原Mock／邀请fragment流程。最终桌面／手机真实API浏览器已核验公开入口不先请求私人auth／org／invitation。
4. 未准备比赛的score/totals/periods/rules/clock为null；READY的真实0须区分“尚未开赛”。时钟沿用原始remainingMs＋anchorServerTime和serverTime，只扣一次；页面离线只标陈旧，不继续写分或自动暂停服务器时钟。
5. 独立确认后本场计入榜单；重开立即整场退出，重确认只计最新一次。FINAL后的合法staff元数据变化不使旧正式确认失效，也不改变业务sourceHash。全部FINAL不自动推进赛事COMPLETED、宣布唯一冠军或淘汰晋级。
6. DISABLE与Event CAS／audit同事务；即使FINAL来源损坏也可撤销，响应standings:null。下一次公开读取404后清屏，重新ENABLE生成全新event/match/team公开身份，旧URL永久失效。轮询不是即时推送，不承诺所有已打开页面零延迟消失。

API可用四个私有管理路由及四个公开GET读取，完整输入／DTO／错误码见[API第9节](API_CONTRACTS.md)。RESULT_SOURCE_INVALID时不要伪造0或直接改数据库历史，先保留证据，必要时撤销公开；不实现公开SSE、缓存worker、OBS、可靠离线或生产部署。

## 5. 验证命令

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test`覆盖不依赖数据库的单测、组件和HTTP行为。`npm run test:e2e`使用显式Mock模式，固定4173端口且不复用其他服务器；桌面与手机项目均为Chromium，手机是设备模拟，不等于Safari、微信或真机。

真实数据库集成执行`npm run test:integration`，TEST_DATABASE_URL必须指向scb_test_*隔离库；最终CI106项通过。`npm run test:api:e2e`使用独立project包装脚本：DATABASE_URL指向一个已存在的scb_test_*控制库，账号须有测试CREATEDB权限，desktop-api/mobile-api各创建随机独立子库并依次迁移／启动API3300及Web4273，退出后只删除本次成功创建的子库。可加`-- --project=mobile-api`或文件filter；`--list`只列用例不连接DB。拒绝生产库名、production模式和自定义config；不改变同IP注册20次／小时防护。最终CI已证明12项真实API及正常清理；额外`node scripts/check-browser-database-isolation.mjs`用故意无效CLI验证失败退出、owned库删除和base保留，SQL使用单参数`[[baseName, owned]]`。前三轮历史见[TESTING](TESTING.md)。实际数据库重启须CI capture→docker restart→verify，不把普通集成当重启。

构建输出包含admin与api。仅预览admin静态构建可用：

```sh
npm run preview --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 4173 --strictPort
```

静态预览不等于部署，API模式还需要相应同源代理及后端服务。P05-A的历史[最终CI39743710053](https://github.com/xyq-dev/small-city-basketball/actions/runs/39743710053)在1cb8e414全部成功：212项源码／组件／HTTP（admin125＋api87）、88项独立PG、12项Mock及10项API浏览器、完整类型／格式／两端构建及真实PG18.6重启。浏览器为官方Chromium151.0.7922.34，手机仅模拟尺寸／输入。结果见[TESTING](TESTING.md)和[P05-A交接](handoffs/P05-A.md)；P04/P03历史分别保留于对应交接。

[首轮CI39742003544](https://github.com/xyq-dev/small-city-basketball/actions/runs/39742003544)在c2c0e834通过207项源码检查、87PG、真实重启、12Mock及原8API；新增2项记分浏览器因native select label失败，修复后才获得上述最终通过。旧3条审查finding已修复且threads resolved；1cb8e414的新自动CodeReview之后已completed无finding，security review未运行，两类检查不混记。文档收口不重复执行应用、PG或浏览器测试。

## 6. 当前边界与接续

P01、P02、P03-A、P04-A、P05-A及P05-B为DONE / MAIN。迁移001–005已在隔离测试库执行、复跑校验；真实PG18.6重启比较37表指纹及业务响应，保留运行中时钟锚点、已释放租约／fence、事件、收据、两份确认历史、排名规则／锁／sourceHash、有效／撤销公开身份与映射，以及原赛程／名单／审计。没有生产数据库或生产部署，重启验证不能当成灾备恢复。生产默认关闭机构及个人自主注册，要求HTTPS及Secure Cookie，但生产环境尚未配置。

P03-A只交付Web报名／独立审核／名单冻结；完整P03的保险文件、本人身份与小程序，P04其他赛制／自动排时／改期，以及完整P05的可靠离线／专业统计仍未完成。P06-A包装代码与006已本地实施并静态CLEAR，但未执行006、真实PG／重启／API浏览器或原生OBS／CEF测试，尚未MAIN或生产接入；微信、云服务及真实视频也未集成。接续先读[当前状态](CURRENT_STATUS.md)、[任务看板](TASKS.md)和分配任务卡，再在独立任务分支实施。

## 7. P06-A本地分支调试（未真实验收）

先核验完整本地source／分支／锁文件，不能把仅DTO远端检查点当完整应用。取得并整合完整代码后，新隔离环境按001→006迁移，再按第3节启动API和admin；006仅已审查，当前尚未真实执行。现有P05-B数据环境升级前核验schema/checksum，不改001–005或删除授权历史。新增配置无需云服务、OBS控制口令、付费依赖或对象存储。

| 本地分支页面 | 用法与边界 |
|---|---|
| `/broadcast` | 当前机构可见events→所选event正式matches全分页，不用scoring-matches；仅有场次权限者不能由此获得赛事管理链接 |
| `/matches/{matchId}/overlay` | 服务端能力决定可读或签发／轮换／撤销；球队上下文不请求空机构API |
| `/overlay/{overlayId}#token=…` | 独立1920×1080透明源，入口先分流、不初始化私人auth／org／邀请；fragment读取后立即清除，仅保留本次内存 |

1. 用合成赛事完成正式排赛。无需发布排名规则或开启公开观赛；当前有效机构OWNER/ADMIN或本届实际EVENT_MANAGER／STREAMER可以管理，global角色、MatchStaff或球队grant不替代实际分配。
2. 在管理页读取fresh Event版本及预览，明确填写1–10080整数分钟后确认签发。ROTATE／REVOKE理由必填1–200字符，弹框固定审阅的Event／Grant版本；不能让后台新数据悄悄替换确认对象。
3. 成功ISSUE／ROTATE只在当前页面内存提供一次完整URL，密码输入框遮罩，通过复制按钮保存进OBS源设置；离开后不能GET恢复secret。不把URL、secret、Cookie、session或截图含密钥的画面提交仓库。
4. 原始源URL可在有效期内重复bootstrap；页面首次清fragment后，无fragment刷新依赖专用Cookie。有效同Grant Cookie复用不增session；Cookie丢失但已清fragment时，重新加载保存的原始URL，不回退私人登录。专用Cookie为HttpOnly／Strict／host-only及单源API Path，生产Secure；Path不是同源安全隔离。
5. 无需准备比赛即可看到有限赛程展示、空比分／空时钟；实际准备后显示真实0，后续记分与时钟按原P05-A流程。坏FINAL源409清屏并继续核对；管理页preview:null及previewError仍保留元数据和撤销能力，不能直接改DB历史“修复”。
6. 命令超时、丢失ACK或不完整响应时，暂停新授权操作，先“重新读取授权元数据”。若已签发但secret未收到，显式轮换取得新身份，不重复ISSUE。版本409同样先读fresh数据；命令没有自动重放或恢复旧secret接口。
7. 需要停用时明确撤销，旧secret／Cookie永久失效。签发者退出或个人撤权不自动关闭既有Grant，机构inactive或固定期限到达则源拒绝；主办方应主动管理授权。已过期未撤销记录再次ISSUE时原子关闭并创建新身份。
8. 源每次完成后2秒串行读取、8秒超时。断网立即陈旧，完整snapshot成功超过30秒清除比分和队名；硬截止按performance发送锚扣完整RTT且只提前，404／到期终止并拒绝迟到200。恢复网络只在重新取得完整权威snapshot后显示，OBS关闭不阻断记分。

网页和管理缩放预览复用同一1920×1080 renderer；加入OBS时明确宽1920、高1080并保持透明。native Chromium153的19状态／三张PNG只证明合成HTTP布局及浏览器alpha透明，不证明原生OBS／CEF合成、隐藏卸载／刷新、保存源后重启或实际推流。真实API浏览器／数据库及重启扩展已编写但未运行，执行入口沿第5节，由集成人CI记录当前head结果；预计123PG和14API不能写成通过。接口见[API第10节](API_CONTRACTS.md)，证据边界见[TESTING](TESTING.md)及[P06-A布局记录](evidence/P06-A/README.md)。
