# ACCOUNT-SECURITY 验收与交接

## 当前事实（2026-11-06T13:59:19+08:00）

状态：DONE / MAIN（源码与隔离验收）；生产未部署。PR43合并SHA`becf8d38e3bc8e2c12059780ed57f52aa35f0bf0`，候选8924194的CI207四作业全部SUCCESS，合并tree与测试tree精确相同。新增初始化/改密HTTPS浏览器桌面与手机视口完整验收均通过，GitHub自动Code Review无finding，独立安全复核无阻断。当前仅追加最终事实与生产交接文档，不改已验收应用代码。

执行目录`/workspace/scratch/62df5b551299/small-city-basketball`；本轮独立分支`test/account-security-browser`，源码经`feat/self-service-owner-password`的PR43合入main。原工作区与用户Windows UI工作未动。Migration049已编写且仅隔离执行，生产未执行；当前无Hermes/SSH通道，生产发布仍待服务器侧执行。

## 历史阶段记录（以下按发生顺序保留，当前结论以上节为准）

状态：REVIEW / BRANCH_ONLY，2026-11-06 Asia/Shanghai。已提交任务分支并创建Draft PR #43，未整合main或上线。

## 实际上下文及权限

- 工作目录：`/workspace/scratch/1de45fa14969/small-city-basketball`。这是云端独立clone，不是用户Windows日常工作区；没有读取或改动其他机器上的未提交UI工作。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 基线及当前HEAD：`ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`。
- 分支：`feat/self-service-owner-password`，从干净main本地新建。
- 本轮仅修改开发源码/文档、编写Migration及执行临时数据库迁移/检查。没有commit、push、PR、merge、发布打包、部署、生产Migration或生产账号/数据/密码文件操作。

## 修改原因与影响

首次部署不再依赖明文默认密码交付。离线维护身份生成15分钟、256bit随机单次链接，服务端仅存摘要；HTTPS `/setup#token=…`由用户输入机构名称、邮箱、显示名及密码。页面读取fragment后立即移除，仅内存保留，通过同源JSON提交，不伪造邮箱验证，不授予平台运营权限。

Migration049新增`first_run_setup`单例持久状态及不可重开触发器。已有真实用户或机构在迁移时标记关闭；仅排除当前代码定义的不可登录系统主体。网页、CLI、签发命令、机构注册、个人注册与开发seed共享状态行锁；公开注册在未初始化时拒绝。新实例API显式开关默认false，维护CLI与API必须各自显式开启。旧CLI兼容但遵守相同一次性关闭规则。

Web现有“个人 ID / 邀请”面板增加“账号安全 → 修改密码”。后端从当前会话确定用户，复核旧密码和账号/会话状态，沿用scrypt及密码规则；新密码不同，支持密码管理器、显示/隐藏及重复提交保护。凭据屏障、密码、全部旧会话（含当前）、未消费恢复令牌和审计原子提交。账号ID、邮箱、可为空的login_name、机构及角色保持不变。离线账号维护也补齐credential_reset_at与恢复码撤销。

没有修改历史001–048 Migration、微信UI、支付或无关业务。常驻API仍仅有runtime凭据；新增权限仅为初始化状态SELECT及initialized_at/token_used_at列UPDATE，不可签发、轮换、删除、建表或管理角色。实际PG发现LOCK TABLE SHARE需要额外表权限，已移除，复用所有真实账号创建入口共同持有的状态行锁。

## 实际验证

| 检查 | 结果与边界 |
| --- | --- |
| API全部源码单测 | 最终118文件、1345/1345通过（包含新CLI保密边界用例） |
| Web管理端全部测试 | 63文件、598项通过；新安全表单10项含StrictMode fragment清理、确认/必填/重复提交与改密后重新登录 |
| 首次初始化真实PG18.6 | 12/12通过：有效/错误/缺失/过期/轮换/重放、显式禁用、确认/未知字段、持久限流、等待互斥期间过期、已有账号、001–048旧实例升级、系统主体区分、事务回滚、网页并发及网页/CLI实际锁等待、开发seed与注册门禁 |
| 改密及现有维护/恢复真实PG18.6 | 28/28通过（新改密10、已有18）：空login_name、身份角色不变、全会话/恢复令牌撤销、无登录态/错误密码/非法Origin/表单无变更、禁用/过期会话、限流、审计失败回滚、双向恢复竞争、并发改密和登录、验证后会话过期 |
| 认证/报名/微信既有真实PG回归 | security、p03-registration、c05-wechat三文件56/56通过 |
| 原有P07首次owner真实PG回归 | 5/5通过，9项不相关runtime测试按名称未选；验证实际双CLI等待、既有个人不能提升、审计回滚及自有测试DB安全清理 |
| 实际runtime HTTP链路 | 1完整场景通过；分别在测试集群初始身份scb_admin和CI同形态scb下重跑。/ready初始化前后及改密后200；签发/轮换/删除/DDL拒绝；缺失/恶意Origin不消费；正常初始化、全部旧会话拒绝、新密码登录及身份不变、关闭不可重开 |
| 实际PG进程重启 | 临时PG进程两次重启后，持久过期时间原样保留、过期令牌拒绝、完成标记不变且重新签发拒绝。令牌只在进程内存使用，没有输出 |
| 宿主CLI私密交付门禁 | 5/5通过，已接入根npm test。stdin/stdout非TTY及CI在读取配置和启动Docker前拒绝；私有文件、固定参数、继承终端、不捕获输出。容器日志驱动none且转发CI |
| Schema静态检查 | 49 Migration、222表、127函数；冻结历史校验与权限清单一致 |
| 类型/构建/格式 | 根npm run typecheck、npm run build、npm run format:check及git diff --check通过。Vite有大chunk非阻断提示，未顺带重构 |
| 独立安全复审 | 无阻断发现；曾发现Compose TTY掩盖宿主CI/管道问题，已加宿主校验入口及5测试修复 |

所有数据库仅独立临时PostgreSQL18.6和合成身份；无生产凭据或数据。测试初次失败为旧readiness数量断言、合成夹具约束/恢复key不一致、表锁最小权限问题，均在对应范围修复并重跑，未把失败算通过。

未执行：真实浏览器页面验收（Playwright下载损坏、备用Chromium启动SIGSEGV）、Docker/实际HTTPS容器演练、完整业务集成套件、c22完整归档备份恢复、微信真机和生产验证。历史c22夹具仅做必要代码适配、类型/格式检查，未宣称完整恢复已通过。

## Migration

049已编写，且仅在临时隔离数据库执行；生产未执行。升级既有实例先按原部署步骤备份、在隔离副本验证001–049及最小权限，保持FIRST_RUN_SETUP_ENABLED=false；不重建OWNER、不改密码和角色。

## 使用方式

1. 全新部署按[安装说明](../../ops/templates/README.md)准备HTTPS与角色分离，在私有配置开启FIRST_RUN_SETUP_ENABLED并启动服务。
2. 部署人员在私密交互终端运行`node ops/setup/initialization-link.mjs /srv/scb/production.env`。用户15分钟内打开一次性链接，在网页自行输入资料/密码后正常登录；之后部署者关闭显式开关。不能通过公开API获取令牌，链接不可进入聊天、普通日志或CI。
3. 既有用户在管理端页头点“个人 ID / 邀请”，在“账号安全 → 修改密码”填旧/新/确认；成功后所有设备重新登录。

## 下一步

先在干净、相同基线checkout审阅本轮diff及新增文件，补真实浏览器和隔离Docker/HTTPS/旧库备份恢复验收。任何commit/push/PR/merge、部署或生产Migration须遵守后续明确授权；本轮没有这些操作。源码仍是本地未提交状态，不能说Windows工作区或GitHub已更新。

## 2026-11-06 提交阶段接续

本会话用户随后明确要求直接按已设计Codex提示词操作，授权commit、普通push、Draft PR及CI必要修复；不授权merge、生产部署或生产Migration。前文未提交/禁止Git为上一阶段历史状态，以本节及后续提交记录为准。

提交前独立复核补齐：API浏览器fresh DB经真实bootstrapOwner建立随机合成首owner再启动测试；运行两次保留相同数据、无示例赛事，真实HTTP注册由拒绝变为允许。新准备脚本7项测试已接入根npm test，宿主CLI合计12项通过。R6训练夹具19项真实PG通过；账号维护、改密、恢复28项重跑通过。共享register竞争失败时只在持久初始化完成后走正常注册。runtime完整HTTP、故意失败后的角色还原、未知角色拒绝3项真实PG通过；原有migrator NOLOGIN/NULL密码恢复、只清理本次创建且OID匹配的角色，满足C22严格角色前置条件。

本阶段产品功能代码未因测试配套而放宽。完整真实浏览器新表单、Docker/HTTPS及C22归档演练仍待独立环境验收。远端main执行前仍为ef62cb1，049编号无冲突；当前目标保持Draft PR，不合并和部署。

## 远端交接恢复点

- [Draft PR #43](https://github.com/xyq-dev/small-city-basketball/pull/43)，分支`feat/self-service-owner-password`，代码SHA `6944170431a536a03122ec4573fa2ef9e3bb6da9`，tree `be8fe89eb842907be3eac76a3a1265cb8fbbe3d1`。
- 提交与普通远端同步成功，本地逐文件tree与远端完全一致；没有force push。HEAD已对齐，PR保持Draft且禁止merge/生产部署。
- 代码后续只有文档接续提交时，以PR最终HEAD为准；核验树差异后可复用本次应用代码验证，不能把旧CI结果转称新CI通过。
- 最终本地相关真实PG共123项（初始化12、改密/维护/恢复28、认证/报名/微信56、P07首owner5、runtime3、训练19），另有浏览器准备脚本真实PG/HTTP验证、实际PG进程重启。宿主CLI与浏览器准备12项Node测试通过。
- 首次Application checks run203已排队，尚无通过结论。CI失败须读取对应日志、仅修复相关问题并重跑；通过后仍保留新表单真实浏览器、隔离HTTPS/Docker及旧库恢复专项范围的明确结论。

## CI204与修复恢复点

CI204头a6e10fb、合并视图a9c85cf，tree一致。admin与隔离production通过；API在既有PG阶段失败，不能记全通过。已读取原始日志，失败为C19新增配置表精确清单缺1行及C22旧schema夹具仍调用新注册门禁。修复仅在c19-upgrade/c22-region-data测试文件，保留冻结历史结构/校验、旧数据指纹及恢复验证，新断言同时验证初始化永久关闭且没有令牌。C22历史身份事务写入后走正常登录，不给产品API加旧库旁路。两文件真实PG11项通过，本地C19为既有模板恢复路径；严格归档路径由CI重验。

已成功项的精确日志：管理端598、API源码1345、原生1196通过/1平台跳过、CLI与浏览器准备12；兼容浏览器1349通过/1335配置跳过，1335份布局证据。隔离production有21最小权限PG、4HTTPS浏览器、Docker持久化与完整归档恢复/quarantine通过；不代表生产更新。API的新增初始化12、改密10、runtime3、维护8、恢复10及C22冻结归档恢复通过，但后续原生/重启/真实API浏览器因失败跳过。最新完整结果须读取[PR #43](https://github.com/xyq-dev/small-city-basketball/pull/43)的检查与验收描述。

## 2026-11-06 浏览器专项接续（IN_PROGRESS / BRANCH_ONLY）

用户本轮在“浏览器验收→安全审查→合并→备份部署”的建议后明确要求继续完成任务。本阶段优先补齐新增表单的真实浏览器验收、必要测试配套、安全审查、普通提交推送及通过后的PR整合；生产执行仍须先核验可用通道、目标版本与备份恢复条件，不能把CI的production作业称为实际部署。

- 唯一集成人：本轮 Codex root；browser_tests 负责独立专项配置/场景/runner；security_review 只读审查。
- 执行目录：`/workspace/scratch/62df5b551299/small-city-basketball`，独立worktree；本地分支`test/account-security-browser`，同步目标为PR43原分支`feat/self-service-owner-password`。
- 开工已核验远端与工作区：origin为本仓库；远端main=`ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`，PR43候选=`0cd86cb9d56503e9254ba683ffeca0bfb12fa45d`，原工作区干净，保留不切换。
- 允许改动：新增浏览器专项测试/配置、仅loopback的临时HTTPS代理、既有隔离runner的固定套件选择、package/CI接线和本任务文档；发现产品缺陷后只做直接相关修复。不改微信UI、支付、历史迁移或生产数据。
- 已重新读取PR43：CI205全成功，尚缺新增两表单真实浏览器成功链路。本轮采用独有随机临时数据库、合成身份、桌面/手机视口；TLS测试使用临时自签名证书，不能声称公共证书或真实手机验收。

### 浏览器专项实现与本地验证

新增固定account-security套件，桌面和手机项目分别使用runner新建的随机临时数据库；先迁移、不预建owner，通过HTTPS页面完成初始化与本人改密。链接缺失/过期/轮换/重放、确认不匹配、错误旧密码、双会话与原Cookie撤销、新密码重登、身份/机构/角色不变均纳入场景。TLS为自有临时证书的loopback代理，非生产nginx或受信公共证书验收。所有凭据为随机合成，仅内存保留；trace、截图、视频关闭，原始异常仅转为固定阶段信息。

已执行：完整typecheck、专项测试TypeScript、完整format:check、git diff --check通过；既有私密CLI/浏览器准备12项通过；桌面/手机各1完整场景成功列出（仅发现测试，尚非运行通过）。真实PG18.6实测两套runner故意子进程失败后保留失败码、只删除自有库且保留control库；实际loopback TLS代理保留Origin/JSON/Secure Cookie并清理自有证书目录；4类不安全TLS启动环境在监听前拒绝。两轮独立安全复核（业务实现与新增配套）无阻断发现。

本地浏览器安装仍因下载归档损坏失败，未声称本地浏览器通过。已接入独立GitHub account-security作业，与原admin/api/production完整检查并行；下一步普通同步PR43并以精确候选CI执行结果收口。未修改应用功能、微信UI或Migration。

### CI206首轮结果与测试定位修正

候选`4b3e97bf3262ffde677221aace4d40ed2cdabe1f`的[CI206](https://github.com/xyq-dev/small-city-basketball/actions/runs/42167881702)专项已真正启动桌面Chromium：缺失/过期/轮换/初始化成功/重放、双会话登录、错误旧密与确认不匹配阶段通过；改密后阶段失败，不能记专项通过。源码核对发现AuthForm可同时出现成功notice与注册能力loading两个status，原测试全局单元素定位不正确；改为按成功文案定位并要求可见，保留旧Cookie重放401、第二会话401、PG全会话撤销及身份保持的全部断言，增加固定细分phase。另显式禁用Playwright自动ARIA页面快照；残余固定错误和静态源码上下文仍随测试输出清理。未放宽产品规则、未修改业务代码。

本地提交的普通git push因无终端Git凭据失败；已通过连接的GitHub按原head快进同步，逐文件blob及完整tree与本地一致，无force。当前私有worktree已对齐远端；用户Windows与原工作区未改。修正后重新执行专项及原全部CI，以新候选结果为准。

## 现有实例生产发布交接（待Hermes执行）

当前ChatGPT执行环境没有已连接的Hermes/SSH通道，没有派发服务器任务或执行生产命令。公开HTTPS只读探测`/health`与`/ready`于本轮返回200，仅说明旧服务正常，不能证明新功能已上线。以下为服务器侧执行清单，不是完成报告。

1. 从PR43最终合并记录取得固定发布SHA。目标主机、当前目录、远端/分支/HEAD、dirty、实际运行镜像、Migration清单、Compose/env/卷和反向代理配置均须现场核验；历史`/opt/projects/small-city-basketball`只作为候选，不当作事实。保留现有Caddy/Compose拓扑和所有现存资料，不直接拿模板覆盖配置。
2. 确认数据库为既有实例，保持`FIRST_RUN_SETUP_ENABLED=false`；不运行初始化链接或bootstrap-owner，不重建OWNER、不改既有账号密码。首次部署向导只供全新实例。
3. 在现有发布规范下停止写入，保存代码/配置/镜像恢复点；生成新的私有完整数据库备份，保留原备份，在隔离副本完成恢复及001–049升级/权限验证后再处理生产。沿用[安装与恢复说明](../../ops/templates/README.md)，按实际部署差异复核命令；不输出任何secret或生产数据。
4. 固定SHA构建应用，使用既有维护身份显式执行迁移与最小权限配置，确认049完成；应用运行身份仍为runtime。重建API/Web，验证TLS、`/health`、`/ready`、静态资源/SPA和登录入口。若任一阶段失败，保持写入口关闭并按已验证恢复点回退；禁止删除数据卷。
5. 用原账号正常登录，确认“个人 ID / 邀请 → 账号安全 → 修改密码”可见。用户自行输入旧/新密码；Agent不代设或接收新密码。正式改密验收须明确记录是否实际执行，不能用隔离CI代替。
6. Hermes返回实际主机/目录、发布SHA、迁移执行前后、备份恢复结果、健康检查和遗留问题；未执行项目明确标注。确认所有实际执行证据后才将“生产未部署”更新为已上线。

### CI207浏览器专项实际通过（2026-11-06 13:27 Asia/Shanghai）

候选`89241947fb180ce8e857d1aee5cb94ca303a79c3`；CI实际merge-ref=`d0fefe45905c9fd9a9db7fdca509da783efca6bf`，两者完整tree同为`505aaac19cf734e7c2623a4223242d726c503d60`，base main仍为ef62cb1。已读取account-security作业原始日志：桌面1完整场景14.4秒、手机1完整场景12.6秒，全部通过。

两视口都通过：缺失/过期/轮换/用后链接拒绝、初始化成功、再次签发拒绝、双浏览器正常登录、错误旧密码不改变会话、确认不同不发请求、改密成功并显示重新登录提示、原当前Cookie重放401、第二会话401且刷新回登录、数据库旧活跃会话0、旧密登录401、新密登录成功、身份与机构/角色保持、审计仅1次、无URL/Referer秘密泄露或页面错误。两个项目库清理完成；两套runner故意失败清理保留失败码和control库。完整回归其他作业尚在运行，最终结论见PR43检查。

本轮第二次独立复核确认status精确定位修复未放宽任何安全断言，自动ARIA页面快照关闭依据锁定Playwright版本源码验证。PR43已转为Ready for review；等待所有检查后再合并，生产未部署。

### 活跃检查点 2026-11-06T13:49:19+08:00

CI207的account-security、admin、production均SUCCESS；API的新旧PostgreSQL和原生页面调用真实API阶段已通过，正在采集数据库重启前基线。候选8924194保持不变，未合并、未部署。已读取专项/admin/production完成日志；最终API日志在作业结束后核验。当前待同步改动仅本任务验收/生产交接Markdown，将随最终main事实收口。

## 最终验收与合并（2026-11-06T13:59:19+08:00）

- 候选89241947fb180ce8e857d1aee5cb94ca303a79c3；CI207测试合并视图d0fefe45905c9fd9a9db7fdca509da783efca6bf；最终合并becf8d38e3bc8e2c12059780ed57f52aa35f0bf0。三者tree精确同为505aaac19cf734e7c2623a4223242d726c503d60，base ef62cb1没有并发变化。
- CI207四作业SUCCESS：账号专项2完整场景；管理端598/API单测1345/原生1196通过及1平台跳过；兼容浏览器1349通过及1335配置跳过，1335份布局与PNG核验；R6 PG143、旧业务PG611、原生真实API21、旧API浏览器24；最小权限PG21、HTTPS4、全manifest实际重启与完整备份恢复/quarantine均通过。两套runner失败后仅清理自有数据库并保留失败码，独立control资源保留。
- 已读取四份作业完成日志；CI206失败仅记为历史失败，不转称通过。新增专项实际验证了成功链路与全部旧会话/旧密码失效，而非仅表单组件测试。
- GitHub自动Code Review在8924194完成，has_any_findings=false且has_unresolved_findings=false。自动Security Review没有执行，不冒称通过；本轮独立源码安全审查和测试配套复核无阻断。
- PR43已由Draft转Ready并以merge方式合入main，无force。合并后的自动重复CI不冒称已完成；本次证据来自相同tree的CI207。后续提交仅四份Markdown事实收口，与验收代码分开，不新增Migration或应用更改。
- 未发布小程序包、未连接生产修改账号/密码/配置、未执行生产迁移或部署。公开health/ready 200为只读旧环境结果。下一位服务器Hermes先核验目标主机/目录/部署拓扑与备份恢复条件，再按本交接和operations文档发布固定合并SHA；既有实例保持初始化关闭，账号与密码保留。
