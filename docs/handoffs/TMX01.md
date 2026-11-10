# TMX01 接续记录

2026-11-10（Asia/Shanghai）；root；IN_PROGRESS / LOCAL_ONLY。研究和本项目差异审计已完成首轮，业务首批接线尚未验收。

基线main`e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`；独立工作树`/workspace/scratch/dc6a786e1a31/scb-tmx`，分支`feat/tmx-research-scheduling`。保留旧main/COS所有checkout与历史；远端PR51为另一个首页任务，不接管。实际权限、允许路径及验收见[任务卡](../tasks/TMX01.md)。

已核TMX源码版本8.52.0/SHA72ba511、MIT实际文件LICENSE.txt；研究涉及网格/场次锁/预演/就绪/裁判/公开/协作/离线/导出。未安装运行TMX，测试定义阅读不等于测试通过。[完整研究](../design/TMX_RESEARCH.md)保留源码依据与无法照搬的行为。

关键差异：小程序和服务器已有权威优化，admin仍本地first-fit；不需复制TMX引擎。静态发现培训占用可能未进预演但DB发布守卫会阻止，实际复现与修复仍待。第一切片复用原保存/检查/发布体系，保留未保存手工输入；不做大UI改版/新网格/逐场锁/持久多方案/新裁判体系。

环境Node24.22.1/npm11.9.0，`npm ci --no-audit --no-fund`344包安装成功。当前无Docker/psql/postgres可执行入口，系统Chromium存在；云环境状态工具和`/etc/codex/network-policy.json`均不可用，不推断外部服务可达性。实际Git fetch及npm安装可用；浏览器/PG应分别尝试本机或隔离CI并如实记录。

下一条：复核本卡研究后按独占路径实现admin权威预演及必要日历投影；每切片对应测试通过再普通提交同步。Git最终SHA/远端状态以实际读取为准。没有应用测试、PG/浏览器成功声明；没有Migration编写/执行、生产部署或正式数据/凭据变更。
