# INT01 全部分支测试与整合

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

| 来源分支 | 固定head | 初始状态 |
| --- | --- | --- |
| main | b19c19a118e63771c6451d93ed3e16de5416ce63 | 含账号安全与COS；CI211精确代码验收后仅文档变化 |
| feat/self-service-owner-password | 89241947fb180ce8e857d1aee5cb94ca303a79c3 | main祖先，无未合入提交；PR43已合并 |
| feat/tencent-cos-media | a4dff06eedb5815e1cfedc48fe57361b1a527a1a | main祖先，无未合入提交；PR45已合并 |
| feat/ui005-figma-complete | 133ba3cd723fc40845c00f8ec0dcd9806c4217fe | PR42；4项未合入提交 |
| feat/wechat-figma-rebuild | 初始6fc06983b9d0093268e25354cca89dace79d1dab；最新3cc97e58be97485a8818072e0a75dfa39607a63e | PR44；代码提交及后续main同步均保留 |

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
