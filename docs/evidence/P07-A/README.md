# P07-A 验证证据

2026-10-23（Asia/Shanghai），root。**DONE / MAIN**；[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8)候选`8809d67a568b86d3ef530ec92785877c29fab80a`，tree`fcb777848e666aac9f81097bca1ddffc3130e543`，本地`dde4c27`同tree。PR8合并`82a3705001da50f60655b07d6174b50f4d84266f`同验收tree；不是生产上线或原生OBS验收。

[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)的[production119995169422](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301/job/119995169422)已SUCCESS，完整日志已读；同run admin119995169199、api119995168877也全部SUCCESS，完整日志已读：432源码/类型/格式/build、124常规PG、12Mock＋14真实API浏览器/39表重启与负向清理通过；加本job16 PG/4 HTTPS合计140 PG和30浏览器。

[合并后CI39829137241](https://github.com/xyq-dev/small-city-basketball/actions/runs/39829137241)同代码tree，最终全部SUCCESS，完整实际执行日志已读。首次production120000292724与admin120000293543成功；api120000293114在124 PG/39表重启成功后，依赖安装耗时11分37秒，15分钟job时限后浏览器被取消，不计首次完整通过。仅重试[api120008473545](https://github.com/xyq-dev/small-city-basketball/actions/runs/39829137241/job/120008473545)成功，124 PG、39表重启、桌面7＋手机模拟7及故意失败清理/控制库保留全部通过。没有改代码、放宽断言或重跑已成功任务；attempt2的production/admin为复用首次结果，不重复计数。

| 实际独立CI检查                | 证据与边界                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 三生产镜像/编译运行           | api/db-tools UID10001:10001，Web101:101；实际Node/contracts/PG客户端可运行，SQL和manifest齐全，无tsx/Vite生产依赖                            |
| 数据库角色及首owner/readiness | 两文件16项真实PG全部通过；包括实际锁竞争/原子审计回滚、越权拒绝、缺/漂移/extra迁移与ACL/扩展门、旧授权隔离与安全清理                         |
| 可信HTTPS及完整业务链         | 临时CA受信任；真实runtime凭据下报名/冻结/排赛/计分/确认/排名/公开/Overlay；Secure Cookie、Origin、SPA404、匿名独立入口、伪造转发头限流均PASS |
| HTTPS浏览器                   | 桌面2＋手机模拟2，四项全部通过；私有深链/登录/能力入口、匿名watch/overlay、fragment清除/专用Cookie/透明像素；无TLS忽略、无产物上传           |
| 生命周期                      | SIGTERM exit0后会话保留；API真实地址变化，Web ID不变且重新解析成功；DB停机readiness失败、同卷重建恢复原会话                                  |
| 完整备份/新实例恢复           | 停全部源写者并采最终基线，PG18 custom dump私有0600；全新第二实例/卷完整restore后39表/schema/checksum/业务快照及备份点fence一致               |
| 恢复隔离                      | 拒绝覆盖既有目标；失败不变源/control；quarantine后旧private/public/overlay凭据均失效，原用户重登无旧机构可用                                 |
| 清理                          | 只清本run project/容器/网络/卷，独立control在项目清理后仍存在，最后显式移除自有control；无全局prune                                          |

基础镜像实际拉取digest：

| 官方tag                    | 实际digest                                                              |
| -------------------------- | ----------------------------------------------------------------------- |
| node:24.22.1-bookworm-slim | sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 |
| nginx:1.30.6-alpine        | sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 |
| node:24.22.1-alpine3.24    | sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 |
| postgres:18.6-alpine3.24   | sha256:898c60cb390d1085bc97bdd6a1ae968757421df394b071848b52b1c09c89d6a5 |

这不是无停机/RPO零/PITR或未知备份后最大fence保证；重新开放恢复环境须外部当前授权清单与显式运维。原生OBS/CEF、真实设备Safari/微信、生产域名/证书/发布及生产Migration均未执行。源码检查、作者报告、独立静态审查、CI和生产证据分别记录；失败修复历史不删除，见[完整交接](../../handoffs/P07-A.md)。
