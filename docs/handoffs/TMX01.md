# TMX01 接续记录

2026-11-10（Asia/Shanghai）；root；REVIEW / BRANCH_ONLY。研究和本项目差异审计已完成首轮，原候选隔离验收已完成，最新main并发整合待组合复验。

基线main`e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`；独立工作树`/workspace/scratch/dc6a786e1a31/scb-tmx`，分支`feat/tmx-research-scheduling`。保留旧main/COS所有checkout与历史；远端PR51为另一个首页任务，不接管。实际权限、允许路径及验收见[任务卡](../tasks/TMX01.md)。

已核TMX源码版本8.52.0/SHA72ba511、MIT实际文件LICENSE.txt；研究涉及网格/场次锁/预演/就绪/裁判/公开/协作/离线/导出。未安装运行TMX，测试定义阅读不等于测试通过。[完整研究](../design/TMX_RESEARCH.md)保留源码依据与无法照搬的行为。

关键差异：小程序和服务器已有权威优化，admin仍本地first-fit；不需复制TMX引擎。静态发现培训占用可能未进预演但DB发布守卫会阻止，实际复现与修复仍待。第一切片复用原保存/检查/发布体系，保留未保存手工输入；不做大UI改版/新网格/逐场锁/持久多方案/新裁判体系。

环境Node24.22.1/npm11.9.0，`npm ci --no-audit --no-fund`344包安装成功。当前无Docker/psql/postgres可执行入口，系统Chromium存在；云环境状态工具和`/etc/codex/network-policy.json`均不可用，不推断外部服务可达性。实际Git fetch及npm安装可用；浏览器/PG应分别尝试本机或隔离CI并如实记录。

下一条：复核本卡研究后按独占路径实现admin权威预演及必要日历投影；每切片对应测试通过再普通提交同步。Git最终SHA/远端状态以实际读取为准。没有应用测试、PG/浏览器成功声明；没有Migration编写/执行、生产部署或正式数据/凭据变更。


## 代码检查点（2026-11-10 Asia/Shanghai）

研究已按GitHub API普通同步08b4e655，tree与本地c113完全一致；CLI push无凭据，不曾force。后端516c200已cherry-pick为1438cc6，admin312bf78已cherry-pick为4fc40ec；两来源作者工作树保留。根持有新增真实HTTP浏览器步骤与文档。root全类型、全格式、两端build、admin678/API1397源码通过；初轮格式失败已修，不拼接成首轮成功。后端作者类型/build/121直接回归是子集；其4条PG仅定义，缺连接实际beforeAll失败/11项skip，不算通过。静态后端无确认P1/P2，前端独立静态审查通过。

下一条：提交本批root浏览器/文档并同步同一候选PR，核验真实隔离PG新增4项及旧回归、桌面/手机预演/采用零写截图、可信HTTPS/完整恢复及所有CI。只有精确候选通过和独立审查收口才可合并。没有新增Migration或生产操作。大UI网格/逐场锁/持久多方案/现场与裁判板仍未实现，需后续效果确认及独立切片。


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
