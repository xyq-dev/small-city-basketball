# TMX01 接续记录

2026-11-10（Asia/Shanghai）；root；REVIEW / BRANCH_ONLY。研究和本项目差异审计已完成首轮，业务首批接线尚未验收。

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
