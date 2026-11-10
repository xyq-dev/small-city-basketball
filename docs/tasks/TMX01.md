# TMX01：TMX研究与权威排程预演接线

2026-11-10（Asia/Shanghai）；root唯一集成人；REVIEW / BRANCH_ONLY。

## 现场与授权

用户要求全面研究TMX，再把有价值功能加入小城市篮球。已核本项目远端`xyq-dev/small-city-basketball`、main基线`e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`。旧checkout在`/workspace/scratch/7ac4ead1fd7e/small-city-basketball`，main本地7b451c5，原工作区干净但落后；保留所有COS旧工作树和作者历史。新独立工作树`/workspace/scratch/dc6a786e1a31/scb-tmx`，分支`feat/tmx-research-scheduling`，基于实时origin/main，开工干净。没有既有开发或测试服务需要接管。

已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION及相关排赛代码。远端仅PR51首页/Figma修复仍open/draft，不混入本卡；最近main应用CI42628279564 SUCCESS属于a8c94de，不能充作本卡验收。沿用已核开发/测试/普通commit/push/PR及审查通过后合并授权，禁止生产、正式账号/数据库、付费、新凭据或公网操作。

## 第一切片与后续边界

1. 固定TMX `72ba511ab026f8442886937ad594d9da9d0add88`（8.52.0），源码及测试定义审阅，不宣称已独立运行TMX。维护完整能力/差异/风险与分期研究。
2. 现有小程序和服务端已具备均衡优化；admin仍旧本地first-fit。首批复用原`optimization-preview`，提供补缺/全稿的只读预演、明确采用及前后对照；采用仅本地，保存/校验/发布仍分别显式执行。
3. 保留原本地建议器及其未保存手工输入能力，服务端预演只读已保存草稿；有dirty时拒绝发起，不自动保存、不降级伪装权威结果。沿用当前排赛区域的组件、字号、颜色和卡片风格，只增必要按钮/说明，不改首页/原生导航。
4. 补查培训占用是否未进入预演/校验投影；如确认，使用现有资源和守卫修复并加真实PG回归，不改历史Migration、不新建第二套比赛或日历。
5. 场地网格、逐场锁、多方案持久化、裁判板与现场Now面板属于后续独立切片。新页面/大改版按用户流程先效果预览确认，再Figma和实现；本卡首批接线不冒充这些能力已完成。

## 独占范围

root：研究、任务/交接/状态、必要契约说明、集成及验收。只读协作分别核TMX源码和本项目缺口。实施作者另建独立工作树，按root分配持有admin排赛/API适配或后端资源投影及对应回归；共享契约、锁文件、CI由root串行处理。不得修改无关模块、AGENTS、首页、支付或人员/记分状态机，不新增TMX依赖。

## 验收计划（尚未执行的不是通过）

- 类型/格式/build及直接相关admin/优化/日历回归；预演零业务写入，采用仅本地；dirty、409、401/403、取消/卸载/身份或版本变化/迟到响应均不可覆盖输入。
- 返回合同须核双版本、唯一完整fixture集合、合法场地/时间/null对、状态/数量与限额，坏响应不可采用；全稿替换须明确确认，不伪造未排时间。
- 服务端培训占用通过真实隔离PG确认，权限、跨机构、inactive/过期占用、发布/改期复核保留；不拿mock或源代码审查当PG验收。
- 桌面/手机实际浏览器布局/交互；mock只验证表现，真实HTTP/隔离PG与可信HTTPS按项目CI单列。无真实OBS/微信真机/生产验收。
- 必要独立审查及同一精确候选CI后方可合并；每一可验证切片代码与文档一起同步，不混入PR51。当前无新增Migration编写/执行。

接续见[交接](../handoffs/TMX01.md)、[TMX研究](../design/TMX_RESEARCH.md)。


## 本地实现检查点

首批源码已整合：后端1438cc6（原516c200）、admin4fc40ec（原312bf78），root扩展`tests/api-e2e/scheduling.spec.ts`。使用指南及API说明同步。root全类型/全格式/两端build通过；admin678+API1397源码通过。首轮format仅根新增浏览器文件未格式，已修并完整重跑。43项新增admin与4项新增PG定义；作者65/121及基线22是上述检查的子集。原本地补排仍在，不把预演sourceHash当预约锁。

真实PG当前缺测试连接，实际beforeAll失败，未算通过；桌面/手机真实HTTP、隔离HTTPS/恢复和完整CI待精确候选执行。后端独立静态通过，admin独立静态审查通过。没有新增Migration、旧001—051不改。初次普通Git push缺凭据，研究检查点已用GitHub API按同tree/expected_sha普通同步至08b4e65；本地c113作者历史保留，后续代码同步以实际远端为准。


## 首轮隔离CI与测试夹具修复

PR52，候选`d3f097b8d91c48213230b472e54631cb3f2fe648`、tree`851d7fd9c52fbe8a8ccfcb34620ced855722defa`，CI42754463456。API job129625502028的Remaining PG实际147项中146通过/1失败，失败仅新暂停→取消用例：暂停后调用公开TrainingService.detail被正确404，不是投影越权。其他3项新PG已执行通过，但本轮整体FAILURE且后续旧PG/真实浏览器未执行，不拼接为最终验收。

修复来源f2b7e7d→根293b7df：仅新测试改用现有私有workspace读取暂停后的真实版本；新增公开仍404、私有确为SUSPENDED和版本递增断言。服务/权限/公开规则未改。根tsconfig.tests类型及该文件格式检查通过；新精确候选须重跑完整CI。

本机Chromium实际启动因sandbox Unix socket EPERM失败；共享浏览器访问本机loopback返回ERR_CONNECTION_REFUSED，未做浏览器通过声明。临时Vite已由root停止，没有公网端口或安全设置变更；浏览器与截图依项目隔离CI完成后另记。


截图证据补充：API浏览器驱动分别启动desktop-api/mobile-api并清理test-results，现有API job不保留PNG。root将本场合成预演截图输出到独立`artifacts/tmx01/`，精确PNG glob由现有固定版本upload-artifact保留7天；不上传trace、JSON、Cookie、setup或密码页面，路径已gitignore。该3文件delta及私有workspace测试修复均经独立只读复核通过，类型/相关格式检查通过。d4b71c7/CI42755284088在此证据补充前启动，若被新候选取消，不记为通过；最终仍须同一精确head完整CI及两张图片实际复核。


## 精确候选检查点（2026-11-10 12:35 Asia/Shanghai）

PR52当前候选`179327701d993cb25d68abe15d29ea952b3f45a6`，tree`a5538a5f1ee0502059e08dd1e68f2ac30018f261`；远端main仍e8c8d735。CI[42755597945](https://github.com/xyq-dev/small-city-basketball/actions/runs/42755597945)中production、account-security已完成SUCCESS，admin/API仍运行；不将部分绿色记为最终通过。旧d4b71c7的42755284088被新候选取代，不作最终证据。普通GitHub API同步使用父提交/expected_sha及force=false；各本地作者分支保留，未覆盖旧checkout。

公开演示`https://courthive.github.io/TMX/`已用真实共享浏览器生成全合成“Scheduling Lab — Garman + Pro”本地示例并进入Schedule：看到按赛事分组的44未排场次目录、Inspector、四个场地列/1—10出场顺序行、日期/可用性/Profile、Bulk mode、Lock和独立发布。只核对这些实际入口，未拖放/发布，也未运行TMX源码或测试；在线演示浮动版本不替代固定72ba511源码证据，更不算本项目浏览器验收。


## 后续研究与设计检查点（2026-11-10 12:50 Asia/Shanghai）

同候选admin也已SUCCESS（678/1397源码、1630微信+1平台skip、CLI12、storage11+1宿主权限skip；兼容浏览器1581/1567配置skip，1566布局PNG），API旧PG步骤仍运行，未宣布整轮通过。四项PR2历史意见按最新代码及直接回归定义确认均已修，无重复改动；详情见[证据](../evidence/TMX01/README.md)。

已补查factory固定v7.33.0/c104a5d源码：TMX overrides实际link本地factory，不能仅由package声称实装版本；该release的basedOnHash仅提示、apply不强制拦漂移、rebase不合并placement、SUCCESS可含跳过，不能替代本项目版本/事务/权限。见研究新节。另生成下一批时间轴桌面/手机V1效果提案，已修正已保存/dirty按钮与手机列表选中状态；未获视觉确认，不做Figma或新网格代码，不能当当前实现截图。


## 并发main保护（2026-11-10 13:13 Asia/Shanghai，REVIEW）

原候选179/CI42755597945四作业全部SUCCESS，API R6 PG147（shared-calendar11，新增4）、旧PG集成组638（含4夹具源检查）、原生HTTP21、PG重启和真实浏览器12+12已完成；两张预演PNG由root下载核哈希并查看。详细平台skip、日志观察和截图见[证据](../evidence/TMX01/README.md)。main在最终合并前变为PR51 merge53ac926，root检查已拦住旧基线merge，保留该39路径全部变更并按普通merge整合。接续必须检查新组合精确CI，不能用原179结果代替；本卡仍未合并/部署。无新Migration。后续时间轴V1效果已生成但未获确认、未做Figma/代码；外部占用块还需新增最小匿名只读投影。
