# INT01 全部分支测试与整合

## 2026-11-06 20:41 Asia/Shanghai 最终四项修复冻结（REVIEW / BRANCH_ONLY）

本节为最新状态，下方各检查点仅为历史。root在共享候选f71210a之上收齐四项已复现问题：青年审核factory登录入口、performance首项独立canRevoke拒绝、裁定审核原因、广告订单列表未提供退款累计时的金额展示。四项只修改3份WXML与1份页面JS，沿原handler、capability、请求ID及版本；不改API/后端/001—050迁移或生产配置。财务来源list SQL只有o.*、trade_order_id、paid_fen，不能把未报告退款当0；缺失/非法/不一致金额显示“待核对”，合法显式0、已退金额及净0按原单位计算，正常SIGNED广告主仍保留原ORDER入口。

四项均已独立复核：青年登录/履历/裁定新增33项与原35项通过；财务前端55项及金额域8项通过。作者相关27/46/130/72项通过。实际加载73/73 Page无错误，43个ui.session页面登录入口已检查。root完整微信1570项：1569通过、0失败、1既有Windows桥平台skip；格式、类型、diff检查成功。累计新增273项回归（26份新CJS）、30份新合成fixture。30新＋1既有审核投影场景×三宽93次DOM契约通过；受影响四页连同既有场景扩查51×3=153次文案/按钮/输入契约通过。上述本地DOM检查不等于浏览器几何或微信真机，最终三宽须由新精确head的CI提供。

此前f71210a的CI219 admin/production/account-security及Windows52成功，API已通过PG与原生HTTP及重启，浏览器步骤仍运行；这些结果仅属旧候选，不替代四项新修复的验收。接下来只提交12份上述源码/测试/fixture与本任务五份文档，普通推进PR46，核对同一新head全部CI、实际三宽、17条审查线程及任何新反馈，成功后merge保留所有来源历史。main仍为b19c19a，未部署生产、执行生产Migration或真实外部/资金操作。

## 2026-11-06 20:34 Asia/Shanghai 退款显示与独立动作检查点

root共享head f71210a，CI219前三作业已成功（浏览器1551通过、1536份证据），API原生真实HTTP仍运行，main未更新。后续四条自动意见已核实并在新worktree收齐：factory青年审核登录、首项canRevoke独立拒绝、裁定review原因、sponsor列表未报告退款却按0计基数。四批仅3WXML/1页面JS与新测试/fixture；无后端/API/迁移变更。

退款真实来源已由两人核实：list SQL只o.*+trade_order_id+paid_fen，DDL无退款累计，decorate不补；新摘要缺失/非法/不一致金额显示待核对，显式0/合法退款和扣净0才计算，不新增API或修改财务状态机。实际新34及旧组合72通过，独立前端55＋金额域8通过，新正常list证据为SIGNED+owner签署且无伪退款字段，保留普通广告主ORDER与原IDs/金额/caps。无旧fixture迁移。

root整合完整微信1570项：1569通过、0失败、1平台skip，格式/类型/差异成功；累计273新测（26CJS）、30新场景，30新＋1迁移场景三宽93次DOM契约通过。青年登录73实际Page factory扫描43会话页已覆盖，余3页独立复核进行中；全部源码保持冻结，待最终复核后普通推进同PR、再核验同一新head完整CI和17条原自动线程。旧219不冒充新源码验收，无生产操作。

## 2026-11-06 20:06 Asia/Shanghai 导航冻结与新候选

0513211/CI218最终四作业SUCCESS，Windows工具51亦成功：admin598/API源码1374/微信1482通过1skip/CLI12，浏览器1542通过与1527份证据守卫；PG143＋620、原生HTTP21、真实API浏览器24、重启/最小权限/HTTPS/恢复全通过。已读取admin与api完成日志，另安全/production完成日志已在该候选监控时读取。该绿色不覆盖后续三导航修复，未混用不同head结果合并。

training仅恢复loginRequired登录反馈，真实loadMine→ui.session→组件action→原login返回training，无报名写；新5＋相关32、独立5＋24通过，41个login/session页只有本处缺绑定。reschedule将共用三tabs置于表单条件外，history/空历史与编辑互斥且可返回，保留日期/时间/场地/原因；新7原6红1绿→7绿。event仅移除排名时隐藏外层导航的条件，public身份显式true、三个public GET上下文保持，排名各子页可回概览/赛程/媒体；新8原7红1绿→8绿。两页组合56、不同复核者新15＋旧38通过，均无新HTTP/写/弹窗副作用。

root最新完整微信1503项：1502通过、0失败、1平台skip；format/typecheck/diff通过。累计206新增（22新CJS）、26新fixture，26新＋1审核投影迁移场景三宽81次DOM成功；再扩查training/reschedule/event既有场景共48×3=144文案/按钮/字段契约成功，不宣称几何。新event场景两个层级同名“赛程”不使用全局单一名称断言，而由精确CSS可见性和新CJS逐按钮enabled/实际handler覆盖，未改spec或业务数据。后端/API/权限/001—050与生产配置不变，下一步普通推进原PR46冻结新head、精确完整CI及13原自动线程/任何新反馈核验后merge。

## 2026-11-06 19:57 Asia/Shanghai 导航补充检查点

当前共享0513211的CI218已通过account-security、production、admin；admin完整浏览器1542通过，1527布局/PNG守卫成功，API已进入原生页面→真实HTTP阶段，尚未全完成。未据前三作业合并，因为后续自动意见指出培训游客无登录入口、改期历史无返回编辑；独立同类检查另确认event排名隐藏外层导航。三处仅恢复既有导航，不改JS/API。

培训3文件已root整合：真实loadMine→loginRequired→组件action→原login返回training，相关32/32和独立新5＋旧24通过；41页login+ui.session绑定检查未见第二处。reschedule在独立worktree已完成共享tabs/空历史/保留未保存字段，新7/旧相关30通过；event同类由发现者独立修复，待两页共6文件冻结后统一复制/独立复核。此时root工作树新增training及任务记录，其他代码保持0513211，main未更新，原生产/迁移边界不变。下一步收齐这组导航修复、完整源码与DOM验证后普通推进同PR，旧218不替代新候选。

## 2026-11-06 19:35 Asia/Shanghai 枚举收口与最后验收准备

完整静态data-*键值差分43个消失项逐一联立JS分支与替代入口，最后补齐participant-materials既有外部保单、governance两路由原请求cancel=true、schedule全稿all模式；其余是替代/既有修复，无继续扩展。约赛摘要按实际OPEN/CONFIRMED/COMPLETED/DECLINED/CANCELLED与awayConfirmed，场地快照仅称预约来源，不冒充实时场地状态。外部保单入口复用原44px按钮且四tab保留，insurance编辑/上传按既有canSave禁用，无购买接口；默认入口及真实编辑态均纳入布局。治理取消仅原ID/actor明确确认，未生效操作建迟到墓碑，已完成仅解保护不回滚业务。schedule all/preserve使用原preview/确认/PUT的false/true与版本/locked保护，不编造pending操作号机制。

新回归实际：保单6项、状态摘要8项、治理取消20项、赛程13项均先红后绿；相关组合43/56/55/124通过。独立复核前两组新14＋既有59、后两组新33＋既有51均通过，声明仅DOM与代码、未称浏览器几何。累计186新增测试（19新CJS），23新fixture。root完整微信1483项：1482通过/0失败/1平台skip，format/typecheck/diff通过；23新场景及一迁移场景×三宽72次DOM文案/按钮/字段契约通过。

CI217 admin完成为1518通过/3失败，三失败是同一e03资格场景三宽：原data.canReview=true却期待申请人“资格核验进度/本人已提交”等。现不改任何原data/ID/amount/capability/consent，仅更新审核人投影和可用审批控件断言，data规范化SHA256仍3a0fe8f86ec1c5acf35ebe5606292c897c4dac663661f8b8e6150adb2545c92d；另增真实非审核申请人单成员场景维持原进度覆盖。未改spec、未skip或放宽安全断言。新head完整真实三宽/证据守卫/四作业CI待本次普通推进后执行；旧217、旧source指纹/数量均不冒充最终结果。无后端/API/权限契约/迁移/生产变更。

## 2026-11-06 19:14 Asia/Shanghai 最终冻结与发布准备

已收齐本轮条件门禁修复：有效资格审核/成员与历史切换、后续约赛逐条选择、录制CANCEL_JOB、无机构身份授课理由、本人评价撤回理由、广告交付/争议理由、撤销招募后历史拒绝理由、标准地区搜索、所有公开档案及其来源管理。十三页WXML仅恢复既有业务，JS仅共享证明取消代次与公开档案同意适配/目标保护，后端与API契约不变。

公开档案追加两轮独立复核解除交叉授权与真实撤选被busy忽略：同意绑定profile id/version/revision，确认前后、UUID后及登记前校验；false/空数组撤选先于busy拒绝新增授权执行。load/session/reset/成功清除绑定，正常首/次档案仍可发布；确认只显示实际名称/主体类型与原披露。重试原_pending/body不改变。唯一旧x08首例由裸setData(bool)迁为携原id/version的真实consent事件，原CAS/版本4/请求同意断言保留，没有单档案fallback。

实际独立证据：四页29/29、资格/招募28/28、广告110/110；公开档案最终新25与相关组合39/39，旧不绑定实现跑同25为13失败/12通过（初始DTO修复13项对0a为12失败/1通过，分别记录，不混合）；另一复核者真实事件确认勾甲发乙被拒、UUID中撤选0次POST、勾乙正常POST。辅助13页检查未发现新增阻塞，实际渲染/事件32断言、既有74项和地区新5项通过。

root最终整合完整微信1436项：1435通过、0失败、1既有Windows桥平台skip；format/typecheck/diff --check通过。累计15份新CJS共139项、16份新布局fixture，16×三宽48次JSDOM契约预检成功，不等于浏览器几何。CI216 admin实际六项失败均为guardian/youth新fixture将CSS误填expectEnabled；现按钮文案与CSS可见性分开，输入阈值增expectValues，未改spec、未降低断言。下一步普通推进原PR46同一冻结候选，完整CI及全部审查线程核验通过后merge；新SHA/CI/布局附件/主线事实仅在实际完成后补入。001—050与生产配置保持原文，无新增或执行生产Migration。

## 2026-11-06 19:05 Asia/Shanghai 条件门禁复审检查点

0a43f4e仍为共享候选，main未更新。后续四条自动审查已核实并在独立worktree修复：current资格预审反被隐藏、约赛仅第一条可选、无机构身份授课者无reason、录制任务无取消。扩大条件组合审查又恢复本人评价撤回原因、广告交付/争议原因、撤销招募后的历史拒绝原因，以及所有公开档案的管理/来源入口；修正不存在的profile.canRevoke条件和checkbox数组撤选语义。普通静态事件名对比不足，已按真实DTO、角色、状态和必填输入联立审查。

root已整合八页WXML、一处公开档案JS、八份新测试和八份新场景；本地完整微信1419项：1418通过、0失败、1平台skip，类型/格式通过，15份int01夹具×三宽45次DOM契约预检成功（不是浏览器几何）。四页独立复核29/29、资格/招募28/28与广告相关110/110通过。CI216 admin实际失败仅新guardian/youth两场景×三宽共6项：expectEnabled误用CSS selector；现改成真实按钮文案，选择器移expectVisible，阈值用expectValues，不改spec、不放宽断言。

追加公开档案复核又复现两DRAFT交叉同意：勾甲会启乙发布，旧通用确认框没有目标信息。当前继续阻塞，唯一实施者在scb-public-archive-controls worktree做id+version绑定、确认及uuid之后重查、撤选/load/session清除；独立复核者event_template_fix。允许本页write新增可选目标校验但不影响其他write；仅迁移旧x08首例为真实consent(id/version)事件，保留原ID/expectedVersion=4/请求同意断言，禁止裸bool或单档案fallback迎合测试。其余页面源已冻结；新候选待此最后隐私门槛完成后统一验证/普通推进同PR。未部署生产或执行生产Migration。

## 2026-11-06 18:46 Asia/Shanghai 私有证明竞态修复

77cd8a8已普通同步到原PR46并触发CI215，Windows工具48成功；独立复审在该精确源码复现conceal后迟到download仍writeFile并previewImage。旧新增证明测试仅覆盖/private元数据读取和完成后隐藏，未覆盖viewProof链，不能据其绿色放行。

授权并完成最小范围扩展：仅`apps/wechat/utils/youth-guardians-page.js`和新增`int01-proof-conceal-race.test.cjs`。私密读取使用独立`_proofGeneration`，隐藏/清理、资源/身份/页面变化、新证明选择后均不能沿用旧结果；actor、download、uuid、write每个await后检查当前代次与资源，迟到写完成时重新登记自有文件再删除，失败保留TEMP_KEY供sweep。conceal保留旧busy直到finally退出，不调用ui.close破坏独立业务写token，不改participant-materials共用清理器或后端。

新增22项竞态测试先按原77cd精确JS执行13失败/9通过，修复后22/22；独立复核实际相关43/43通过，覆盖正常PNG/PDF、旧请求取消后新读取、早期ENOENT/迟到写/删除失败的持久追踪。root已整合并运行完整微信1355项：1354通过、0失败、1既有Windows桥平台skip；全仓format/typecheck及diff --check通过。累计58项新增测试、七份新布局夹具。下一步以77cd为父普通推进同一PR，重新验证同一新head完整CI；215属于前一候选，不能作为本次验收。后端、权限契约、Migration和生产配置无变化，无生产操作。

## 2026-11-06 18:35 Asia/Shanghai 修复候选准备

root 已将独立 worktree 最小修复整合到 `/workspace/scratch/7a5167ea2881/small-city-basketball`，本地分支改名 `integrate/all-branches-20261106`，基线仍为 `cc3c944`，尚未更新 main。五页 WXML 恢复撮合收方回复、转换核对、源预约查看、席位重开和返回、教练本人独立确认、分组模板组数、监护人显式证明查看和隐藏、青年审核工作台规则配置。接单授权卡标题同步校正为其实际操作；既有 JS/服务端能力与确认门槛不变。

新增五份独立 CJS 共36项测试、七份独立 `int01-*` 布局夹具，既有样本与矩阵 spec 未改。测试从真实模板可见控件接到原 handler 与请求体，覆盖无权、忙碌、未知结果、取消确认、本人身份与隐私清理，不仅检查方法存在。三组独立实施者/复核者完成定向验证；另对其余页面旧新事件、操作常量和输入字段逐一比对，未发现其他高置信度入口遗漏。root 已实际重跑完整 `npm run test:wechat`：1333项、1332通过、0失败、1既有 Windows 桥平台跳过；`npm run format:check`、`npm run typecheck`、`git diff --check` 通过。新增 CJS/JSON 已统一格式化。

本地 `playwright install chromium` 返回损坏归档，浏览器几何未执行；七份新场景的真实三宽布局交由同一新 head 的完整 GitHub CI，不降低或跳过既有门禁。旧 #214 四作业、24真实API浏览器、21原生HTTP、143+620 PG 与隔离恢复全部成功，仅作为旧候选记录。新候选 SHA、CI 及最终合并结果在实际发生后补记。本轮新增/执行生产 Migration 均为无，后端与生产配置未变。

## 2026-11-06 18:28 Asia/Shanghai 阻塞审查与最小修复

补查 #46 远端自动审查，发现精确候选 `cc3c944` 的四条未解决问题，均已由代码与既有服务端契约核实：撮合详情把接收方意向回复藏在需求管理权限内（P1）、撮合缺少转预约核对入口（P1）、教练本人资料确认入口遗漏（P1）、分组赛模板组数输入遗漏（P2）。此前独立复审只覆盖选定的权限/生命周期回归，未发现这些模板能力入口缺失，原“未发现阻塞”不能作为本候选最终放行结论。

暂停合并。独立 worktree 分别修复 matching、training-manage、event-setup，仅恢复原有 WXML 入口并新增针对性测试，不改后端、API、权限或 Migration；另行只读审查其他页面的原业务入口是否遗漏。matching 同页还核实原预约查看、重开席位及返回列表入口遗漏，允许一并恢复，保持既有能力与忙碌/未知结果门禁。修复统一整合到原 PR 后重新验证新精确候选；#214 的结果仅属于旧 `cc3c944`，不得冒充修复后的 CI。

## 2026-11-06 18:10 Asia/Shanghai 最终整合接管

本会话由 Codex root 接管最后检查与合并，唯一写入人负责本卡、交接及汇总；独立审查者只读业务与测试。现场为 `/workspace/scratch/7a5167ea2881/small-city-basketball`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，本地记录分支 `docs/int01-finalize-20261106`，起点与待合并候选均为 `cc3c9441e0968fab8bd792dfe1ca5f7d529c35be`，接管时工作区干净。允许检查、必要修复、文档同步、普通 Git/PR 及审查后合并；本轮不扩大生产或外部服务配置范围。

已重新列举远端分支并验证五个原始来源 head 全是候选祖先；相对当前 main `b19c19a118e63771c6451d93ed3e16de5416ce63`，后端、契约、Migration、CI 工作流与生产配置无差异。PR #46 为非草稿且可合并，PR #42/#44 是已包含的来源。精确候选 [Application checks #214](https://github.com/xyq-dev/small-city-basketball/actions/runs/42199398486) 仍运行，账号安全作业及 [Windows 工具 #47](https://github.com/xyq-dev/small-city-basketball/actions/runs/42199398495) 已成功；不提前记录完整 CI 或合并成功。

最终独立只读复审未发现阻塞：10 份定向回归 103/103 通过，0 失败、0 跳过，覆盖预览门禁、异步身份和页面生命周期、预约筛选、只读人员名单及独立写权限。249 份变更夹具的既有数据键逐一比对，未发现修改金额、ID、权限、同意或未知结果来规避断言。测试由独立审查者在上述精确候选执行，root 复核两份日志结尾；日志位于 `/tmp/scb-integration-review-tests.log` 和 `/tmp/scb-integration-review-extra.log`，不是 GitHub 附件。CI 测试 merge-ref `f0f0147e1a83dba9c7d420ff3946787c301aaffa` 的 tree `eb6baf47e4b2e0cd896b5d940af8f843ac4b4550` 与候选精确一致。admin 已完成且成功，API 与隔离 HTTPS/恢复仍待完成。

- 状态：REVIEW（精确候选完整CI与最终矩阵待验）；integration：BRANCH_ONLY；日期：2026-11-06（Asia/Shanghai）。
- 唯一集成人：Codex root；UI005、UI006分别由独立Agent审查，隔离worktree执行测试。
- 工作目录：`/workspace/scratch/1385f4a4fde1/all-branches-integrate`；分支：`integrate/all-branches-20261106`。
- 仓库：`xyq-dev/small-city-basketball`；起点main：`b19c19a118e63771c6451d93ed3e16de5416ce63`，原工作区干净。
- 本轮用户明确要求“把所有分支都测试，然后合并”：允许必要修复、commit、普通push、PR、隔离CI及验收审查后合并；不包含生产部署、生产Migration/数据、外部凭据或付费资源。分支旧文档的禁止Git操作是历史权限，由本轮明确授权覆盖。

## 已核验的全部分支

| 来源分支                         | 固定head                                                                                   | 初始状态                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| main                             | b19c19a118e63771c6451d93ed3e16de5416ce63                                                   | 含账号安全与COS；CI211精确代码验收后仅文档变化 |
| feat/self-service-owner-password | 89241947fb180ce8e857d1aee5cb94ca303a79c3                                                   | main祖先，无未合入提交；PR43已合并             |
| feat/tencent-cos-media           | a4dff06eedb5815e1cfedc48fe57361b1a527a1a                                                   | main祖先，无未合入提交；PR45已合并             |
| feat/ui005-figma-complete        | 133ba3cd723fc40845c00f8ec0dcd9806c4217fe                                                   | PR42；4项未合入提交                            |
| feat/wechat-figma-rebuild        | 初始6fc06983b9d0093268e25354cca89dace79d1dab；最新3cc97e58be97485a8818072e0a75dfa39607a63e | PR44；代码提交及后续main同步均保留             |

另核验本地COS adapter/schema工作分支均停在ef62cb1且已是main祖先；其未提交实现/文档由此前COS01整合交付，不重复覆盖main或清除旧worktree。没有其它远端分支（完整5条列表）。

## 整合规则与允许范围

正常合并保留全部来源提交。UI006任务明确以最新Figma重建、替代UI005旧DOM和覆盖样式；视觉冲突以UI006为准，UI005有效业务修复、独有证据与工具分别保留。逐一核对JS/handler、测试和fixture，不能用整个分支目录覆盖main。保留现有账号安全/COS、001—050迁移及API/权限，不顺带改后端、资金或生产。

先运行各未合入分支的Linux微信源码测试与独立审查，再验证精确整合候选的完整CI（源码/格式/类型/构建、原生PG、页面真实HTTP、浏览器、权限和隔离恢复）。候选变更后旧CI不代表新候选成功；合并前核验所有来源head均为整合候选祖先、审查问题解决、完整CI通过。

## 检查点

- UI005原始133ba3c：Linux微信测试1208项，1207通过、0失败、1既有Windows桥测试跳过。
- UI006原始6fc0698：Linux微信测试1256项，1255通过、0失败、1既有Windows桥测试跳过。独立审查额外发现预览可通过首页/账号导航进入正常业务页，属于阻塞；正在补最小门禁和事件回归，不能仅凭原测试通过合并。
- 已将UI005合入独立整合worktree；第二次UI006合并产生192处冲突。172处视觉/夹具/测试及18处JS已在独立审查后解决，两个汇总文档保留main及两轮历史记录。UI005旧全局覆盖会污染新页，已采用UI006/main原版app.wxss。尚未共享整合候选、尚未完成最终CI或合并。

详见[接续](../handoffs/INT01-ALL-BRANCHES.md)。

- 后续审查：UI006预览导航隔离已修复并补回归；记分teamStat迟到弹窗回调和local-manage旧账号异步回填两项真实问题正在修复。旧UI005断言需迁移到新组件，保留原安全/可用性意图；同时发现预约底栏忽略当前筛选，已恢复openCurrent与filteredCount门禁。
- 整合类型检查通过；全仓格式检查发现32份UI006未规范文件，已仅格式化这些文件。完整整合微信测试和三宽布局仍待最终修复后执行，不把原分支绿色当成本候选通过。UI005额外12个状态别名须同时纳入UI006矩阵，保留证据清单一致性。

- 共享检查点：原生微信源码整合回归1288项，1287通过、0失败、1既有平台跳过；全仓类型与格式通过。预览隔离、记分迟到选择、同城旧身份异步回填及预约筛选底栏修复均已纳入。7页CSS的44px触控修复已编写，真实矩阵复验进行中；97个旧夹具/文案正在迁移，精确三宽与完整CI尚未完成。本检查点不代表可合并。

- Git检查点已普通同步到远端`integrate/all-branches-20261106`：7984dbdfe41a2203686f775b0379c021e94ee9d3，三个父提交分别为main b19c19a、UI005 133ba3c及UI006 6fc0698，全部原始分支head均为祖先。没有重写来源分支或更新main。
- 第二代码切片：恢复工作人员只读名单切换、报名最新审核理由；测试渲染器安全保留ARIA以验证可访问加载态。整合微信1297项：1296通过、0失败、1既有平台跳过；格式通过。核心/几何局部浏览器验证分别103/103及15/15，不等于全矩阵。还在恢复审核收起按钮触控、公开目录地区、既有收费说明和完整改期历史；真实后端及生产均未变。

- 最终共享候选准备：稳定远端检查点为0e8bd553df141319c023ef83ca9bf472036a1885。已完成全部已知源码修复，包括材料按钮44px、目录城市/收费说明/改期全历史恢复、16px球衣输入、三类赛事表真实横滚、未知报价原说明；未改变排序算法/API/计分/授权。运行源码668文件最终SHA256为86d8c73935d6f805250807c0e00822b0b2d4aae950aebee2c728422110451cb5。
- 测试迁移独立审查通过：110JSON的金额/主体/ID/cap/consent/unknown/frozen及12状态标识保持；14个互斥view仅拆显示分栏。匹配说明覆盖已恢复；4份样本仅加可见“合成”展示前缀，IDs/价格不变，相关拼接期望已同步。几何门禁按UI006的88px次页页头/共享token迁移，仍验证44px触控、16px输入、14px主选择文本、金额边界和成员行数，不恢复旧DOM。
- 最终快速验证：微信1297项，1296通过/0失败/1既有Windows桥平台跳过；全仓类型/格式通过，后续仅补该页头来源断言及已验证夹具字符串。首轮1459矩阵1438通过/21失败均已定位修复；同86d8源复验仅有“合成”前缀的旧拼接期望未同步，已用1804单句补丁修正，最终1459复验与1458证据守卫仍待完成。首轮完整日志及source hash保留，失败PNG被后续运行清理，未冒称保留原图。最终GitHub四job CI尚待此精确共享候选启动；不能将历史局部/原分支绿色冒充最终通过。

- 最终本地验收完成：1459/1459通过（1458布局＋1真实DOM可访问性/CSP/惰性事件控制），6.7m，1458份PNG/JSON证据守卫通过；前后runtime86d8c739、helper69729089、403测试文件5c35bf7e不变，root逐文件核验403用例文件与验收副本一致。Chromium153为本地兼容测试，非微信真机；GitHub完整四job尚待最终共享候选。
- 发布前并发核验：UI006远端新增3cc97e58be97485a8818072e0a75dfa39607a63e，双亲为6fc0698与main b19c19a。完整2767树条目核验，2559个非冲突文件与旧UI006/main正常合并完全一致，仅两个汇总文档冲突处理；无运行时代码变化、不使86d8验收失效。最终整合提交将保留该最新head为父提交，文档冲突保留本任务及全部已整合main/UI历史。未覆盖来源分支。
