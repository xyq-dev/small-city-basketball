# TMX01 验收证据

## 最终组合证据（b118，同head四作业SUCCESS）

源b11848a9c3f02684ed823b92c03adb7a41929384；测试merge717dbb2362f0bf501a4ac133763735b90567c6d4；实际main merge b8dca5b3053f660b5cbce4ebac60edf0c11a8bf4；tree均36c81609527402521ce51759c2635874d7f6d750。CI42760884290，原main53ac926/首页39路径完整保留。以下原179/42755597945为历史证据，不拼接为本轮通过。

| 实际执行的作业 | 同候选结果 |
| --- | --- |
| admin attempt2，129658282093 | 全格式/类型/构建；后台678、API源码1397、微信1638通过/1平台skip；setup12；storage11通过/1宿主限制skip；兼容浏览器1581通过/1567既定配置skip，1566布局PNG |
| API attempt1，129646021582 | R6 12文件147项，shared-calendar11含新增4；旧PG组72文件638（内含4静态夹具源检查）；原生真实HTTP21；PG实际重启；桌面12/手机12真实API浏览器及owned清理/失败码/control库边界 |
| production attempt1，129646021927 | 真实PG21、可信HTTPS浏览器4；TLS/来源/权限/会话持久、第二PG/卷完整归档恢复与旧授权隔离、仅自有清理 |
| account-security attempt1，129646021883 | 桌面1/手机1完整真实HTTPS账号流程；过期/轮换/复用初始化拒绝、本人改密全旧会话撤销、身份保留及清理 |

admin首次129646021984只在外部apt字体安装等待25分钟后cancelled，未进入应用检查。API仍运行时单job重试被GitHub“本轮仍运行”403拒绝，不是权限或自动审批拒绝；待API成功后重试该job完成。attempt2中的其它成功check ID为复制/继承，未当它们重新执行。root及独立审查者已读上述真实完成日志，未靠CI状态替代日志。

新截图[artifact13738912800](https://github.com/xyq-dev/small-city-basketball/actions/runs/42760884290/artifacts/13738912800)，7天。ZIP SHA256 `349044efcdcddfa179c30c1ea6c10f5b2337c78c791842311ce538513a0615e5`。桌面1440×3982，PNG `2975e0728fe46112527b042cad3c4d53d175b4bc29c7b640fb25ced9b756197c`；手机逻辑390/DSF3，PNG1170×15027，SHA256 `99758cb7955e5f4c52ab8dc1de3c3cb137b2acf0edcbee58d4e6d1fbe7a8939b`。原始两张均下载核SHA/尺寸，root实际查看新增预演区裁切（手机还原逻辑宽）；按钮、原→建议、长合成名称和采用说明可读，无新区域裁切/重叠。不是全站像素签收或新时间轴设计还原。

主线合并前最新head、main、四个success check、reviews/comments均复读；后两者为空，不冒称自动Code Review/Security Review批准。前后端及main整合边界已有项目内独立静态复核。无新增Migration/生产操作。日志审计与C19夹具限制沿下述记录保留；未新增“所有警告已解释”的声明。

用户确认后的Figma时间轴V1见[设计交接](../../design/TMX_TIMELINE_UI.md)：原生可编辑层、无整图栅格、两端/11状态/全稿确认均经结构与截图复核，原21页保留。该稿不算新网格应用实现或真实浏览器证据。

## 历史与详细检查记录

2026-11-10（Asia/Shanghai）。原候选179已完成隔离验收；main并发合入PR51后，组合候选尚待重新验收。未完成项目不计通过。源码与隔离验收、公开演示、独立审查及生产分别列出。

## 精确对象

- PR：[52](https://github.com/xyq-dev/small-city-basketball/pull/52)。源候选`179327701d993cb25d68abe15d29ea952b3f45a6`。
- CI：[Application checks 42755597945](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945)，attempt1。
- 实际CI checkout `be0922fb7a5ab329e5c18d3e82f87c1e456495e3`，父为main `e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`与上述源候选；两者tree均`a5538a5f1ee0502059e08dd1e68f2ac30018f261`，已通过Git Data API复读核对。
- 本地首批全类型、全格式、两端构建、admin 678/API 1397源码测试通过；作者相关子集不叠加。首轮新增浏览器spec格式不合已修复并完整重跑。无新增依赖、Migration或生产配置修改。

## 同候选CI

| 作业 | 状态 | 直接证据 |
| --- | --- | --- |
| [production 129629218776](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945/job/129629218776) | SUCCESS | 3文件/21项真实PG；可信TLS业务链及Cookie/Origin/SPA/匿名读取、来源限流/拒伪转发头；桌面2＋手机2共4项HTTPS浏览器；同卷重建/API换IP会话保持；完整归档恢复至第二PG/卷，manifest表/业务快照/fencing一致；旧私有/观众/overlay凭据隔离；仅自有清理，control卷保留 |
| [account-security 129629218869](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945/job/129629218869) | SUCCESS | 桌面1＋手机1共2项可信HTTPS真实PG完整流程；初始化链接缺失/过期/轮换/复用拒绝，错误密码不撤会话，确认不一致零请求，本人改密撤销全部旧会话/身份保留/新密码有效/无URL-referrer泄漏；故意失败退出码和owned DB/control DB清理边界检查通过 |
| [admin 129629218442](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945/job/129629218442) | SUCCESS | 全格式/类型/构建；admin69文件678项、API源码124文件1397项；微信1631项中1630通过/1平台skip；初始化CLI12/12、存储设置12项中11通过/1宿主uid限制skip；兼容浏览器1581通过/1567配置skip；1566份布局及PNG守卫通过（非微信运行时） |
| [api 129629218910](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945/job/129629218910) | SUCCESS | R6真实PG12文件147项；shared-calendar11项含新增4项；旧PG集成组72文件638项（内含4项静态夹具源检查）；原生页面→真实API21项；PG实际重启恢复；桌面12＋手机12真实API浏览器；owned数据库/失败退出码/control库保留通过 |

## 失败与修正

首轮d3f097b8/CI42754463456的API Remaining PG为146/147，新增暂停→取消用例错误地调用公开detail，暂停后的正确404导致失败。仅夹具改用现有私有workspace读版本，并补公开404/私有SUSPENDED及版本递增断言；未放宽权限。该首轮后续旧PG/浏览器未执行，不能拼成通过。d4b71c7/CI42755284088被最终截图留存候选取代，不算最终证据。

本机无真实PG入口，作者beforeAll连接失败且11项skip不算通过。本机Chromium因sandbox Unix socket EPERM启动失败，共享浏览器无法访问本机loopback；本轮未通过安全绕行或开放公网来测试。本机Mock页面不计浏览器通过；依赖上述精确隔离CI实际结果。

## 截图与审查

精确API浏览器新增只读预演/本地采用/双重确认/脏输入阻止及PG零写入断言。合成页面截图仅输出到`artifacts/tmx01/desktop-api-server-preview.png`、`artifacts/tmx01/mobile-api-server-preview.png`，现有固定版本upload-artifact留存7天，名称`tmx-scheduling-previews`。附件13737122963已下载核ZIP SHA256 `41742bf36da3ec94e580d0bc133ba1fb9bcd14d661a5e41525a46335f5e6a35d`。root实际查看两张完整PNG及新增预演区裁切，按钮、原→建议、三条结果与长合成名称换行可读，未见新增区域裁切或重叠；保留原风格，非新时间轴设计稿还原。桌面1440×3982，PNG SHA256 `05ce8efa02c4b08c1ac797d7cd9e39cbf5daeacd0c13752750343f1f792fce0e`；手机逻辑390px、DSF3，PNG1170×15027、SHA256 `ad26785c05fe605b23d39958f5f97bf0d20ff2ea076bcd21053812e10af67dc9`。均为当前合成数据的内部验收图，未另上传到文件服务。不上传trace、JSON、Cookie、setup或口令页面。

前后端、13行测试夹具修复及截图留存delta经独立只读复核，无必要P1/P2；此为项目内独立审查，不冒称GitHub自动Code Review/Security Review。最终合并前复读同head检查/评论与main并发状态。

## 限制与下一步

隔离production作业不是正式部署；手机为Chromium模拟，不是微信或Safari真机。没有真实OBS客户端验收、真实账号/支付/外部凭据操作。没有新增Migration编写或执行；CI仅重新执行既有001—051临时迁移。日志npm ci有3项high severity审计提示及esbuild安装脚本提示，锁文件未改；后续只读npm audit分类见下，不据此宣称完整安全扫描通过。

TMX固定72ba511源码/测试定义审阅；另在浮动公开演示生成全合成排程实验，核对目录、四场地/顺序行、Inspector/Bulk/Lock/发布入口，未执行拖放或发布，不等于TMX全功能测试。新时间轴网格、逐场锁、多方案持久化、裁判板和现场聚合未实现，依[研究分期](../../design/TMX_RESEARCH.md)另卡。


## PR2历史四项只读补查

在当前e8c8d735及候选179核验，相关文件不在TMX01业务diff内；四项现行修复均在，无重复修改。这里是源码/回归定义审阅，具体运行结果仍以同候选已完成作业为准。

| 历史意见 | 当前代码及直接回归 |
| --- | --- |
| scrypt资源限制 | `apps/api/src/security.ts::passwordSlot/derive`每进程1活跃＋最多16等待，溢出503，finally释放；`src/security-resources.test.ts`3项与security.test实际scrypt。不是跨进程全局额度 |
| 赛事版本冲突恢复 | `apps/admin/src/App.tsx`保留输入/禁旧重发，显式放弃重读、取消也重读，失败不恢复旧编辑；App.test两条直接回归，服务器版本不符仍409 |
| 禁注册入口 | RuntimeApp按机构/个人各自严格true capability展示；hook加载/失败/取消fail-closed，登出重读；API关闭开关仍403。Registration.test矩阵及runtime-http/runtime-config回归。机构禁注册、个人明确开启是合法独立配置 |
| 过期限流清理 | `service.ts::rateLimit`请求触发，独立批次清理1小时前最多100项，SKIP LOCKED并再次核时后计数；所有当前窗口≤3600秒。security.integration覆盖有效限制、并发重置及不同过期key，非定时全量清扫 |


## 安装告警的只读分类（当前源码，非生产暴露验收）

本地`npm audit --json`正常返回漏洞退出码1：3 high/0 critical，涉及两条公告及Nest上游依赖链计数，非三种独立漏洞。实际安装@nestjs/platform-express12.2.0、body-parser2.3.0、multer2.4.0；package/lock未改。

- body-parser [GHSA-27r3-jxmh-p828](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828)：压缩请求体尾随数据导致进程DoS；官方建议升级2.4.0或关闭inflate。当前`app.ts::createApi`显式`bodyParser:false`，`request-body.ts`全部六个自有JSON parser均`inflate:false`。同候选admin日志明确request-body.test七项通过（含压缩请求拒绝），这是既有缓解，不是升级或动态利用验证。
- multer [GHSA-q7qp-rjg7-q26m](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m)：异步fileFilter在teardown后回调的DoS；官方修复2.5.0。当前非测试API源码未使用MulterModule/FileInterceptor/FilesInterceptor/AnyFilesInterceptor/multer/fileFilter，也没有multipart解析通道；媒体走既有有界JSON/base64通道。故静态未发现当前触发路径，但已安装受影响版本仍在，不能写“无漏洞”。@nestjs/platform-express的high来自该multer依赖链。

上述仅对e8c8d735/179当前代码，不能推断正式站点版本或安全状态。依赖协同升级与锁文件整理应独立后续卡，保留当前HTTP边界，补相关请求解析/上传/Nest启动及必要隔离CI；不在TMX功能收口时无审查混入升级，也不允许后续启用压缩/multipart时无视这些条件。没有生产DoS探测或生产改动。

独立只读复核另从main.ts唯一生产入口、全部解析器挂载点及已安装body-parser/lib/read.js确认：非identity编码在创建解压流前415；未发现生产Multer拦截器/异步filter挂载。当前候选未扩大公告触发面，未因此识别PR52新增必要P1/P2；结论仍是静态可达性分析，不是消除受影响依赖或生产安全验收。


API完整日志另有MaxListeners/pg并发查询弃用、Media object cleanup failed及Database idle connection error输出，未导致本轮失败；后两条日志未给完整原因，未将其说成全部已解释。C22媒体清理警告出现于旧schema测试兼容夹具；不冒称生产缺陷已复现或修复。C19归档升级演练在测试夹具内适配过7条早期checksum，不能扩大为生产原样升级验收。

## 并发main整合（2026-11-10 13:13 Asia/Shanghai）

合并前重新读取main，发现PR51于05:09:13Z合入`53ac92640e3dc1e11c5022e81ac0f6ba7f1980d3`，来源`aeda4af067fbc026e5914e5ddaddd0719983c84b`。root预期main检查拦住合并，未调用旧基线merge。其39项变更仅微信页面/组件/图标/回归/两份UI006文档及fixture，与TMX业务文件不重叠；保留全部，按普通merge并入任务分支再跑精确组合CI。上述42755597945结果仍只属于179/be0922，不冒称新组合已通过。
