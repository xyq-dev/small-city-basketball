# C05 验收证据

2026-10-24（Asia/Shanghai）；root。[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)已合并main `d4f6500453f293499dcc0d189c084156026db4f1`，source`9abeb5c8aeaf294c1df75320d0c7bf4592fc1d23`；候选与合并的tree均为`23c4620a42b0399976876fd23404fa6c8773b54f`。最终第五轮三个job全部SUCCESS，完整原始日志经root与独立审查分别核对；合并后CI40003519494三个job同范围全部SUCCESS、无重试，完整原始日志已核对。不是生产部署。

| 轮次 | source | CI | 实际结果 |
| --- | --- | --- | --- |
| 1 | 19212ce | [39996944016](https://github.com/xyq-dev/small-city-basketball/actions/runs/39996944016) | 三job失败；012裸CASE导致PG42601，API及production迁移被阻；opsREADME格式失败 |
| 2 | 1a467042 | [39997736172](https://github.com/xyq-dev/small-city-basketball/actions/runs/39997736172) | admin成功：908源码+11VM、12Mock、strict/build/format；API198通过/2失败/36跳过，production16PG通过后角色维护审计NULL actor失败；测试file共享登录IP预算也导致429 |
| 3 | d9b8454 | [39998592777](https://github.com/xyq-dev/small-city-basketball/actions/runs/39998592777) | API237/238通过，仅成员fixture期望404实403；production16PG通过并推进TLS媒体下载后，driver断言把字符串传assert.match中断。admin完成910源码+11VM/strict/build/format，Chromium安装慢；后因第四轮普通推送按并发规则CANCELLED，未执行浏览器 |
| 4 | 16e5697 | [39999662348](https://github.com/xyq-dev/small-city-basketball/actions/runs/39999662348) | admin SUCCESS（914源码+11VM、12Mock/strict/build/format）；API SUCCESS且完整日志已核：238真实PG、58表实际PG重启验证、桌面12/手机模拟12真实API浏览器及正常/故意失败owned清理通过；production16PG通过后媒体下载严格头断言发现nosniff重复，故FAILURE，尚未完整恢复 |
| 5（最终候选） | 9abeb5c8 | [40001590258](https://github.com/xyq-dev/small-city-basketball/actions/runs/40001590258) | admin/api/production全部SUCCESS、无重试；914源码（410+504）、11VM、254真实PG（238+16）、12Mock＋桌面12/手机模拟12/可信HTTPS4浏览器；15迁移/checksum、58表实际PG重启/第二实例全量恢复、实际媒体字节与Range、旧授权隔离、正常/负向owned清理全部通过 |
| 合并后 | d4f6500 | [40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494) | admin/api/production全部SUCCESS、无重试；同范围914源码/11VM/254真实PG/12Mock＋28真实浏览器、15迁移/58表重启及第二实例完整恢复、旧授权隔离和正常/负向owned清理全部通过；完整日志已核 |

修复逐项：012CASE整体括号；两处审计在同一财务/维护事务插入DISABLED系统用户以满足原NOT NULL/FK（不放宽DDL/ACL）；测试每file恒定真实loopback TCP来源，应用限流及代理信任不变；商业fixture显式证明成员403/非成员404；no-store用严格RegExp断言；自动审查P2使GROUP记分表单固定加时，并保留RR平局，新增4组件回归；nginx隐藏上游重复的X-Content-Type-Options，由边缘保留单个nosniff always，API直连头与严格断言不变，真实nginx在最终第五轮严格断言通过。失败及被替换任务不当作成功，不拼接不同source片段。

## 证据边界

源码/JSDOM与小程序VM不代表真实浏览器、微信或支付；Native协议用合成RSA/AES及受控transport，微信身份用注入exchange。真实PG项使用隔离PostgreSQL18.6；production job指隔离的生产模式可信HTTPS包，不是正式服务器部署。桌面/手机项目采用Chromium（手机模拟，非iOS Safari或微信真机）。媒体合成PNG/MP4/PDF含实际字节，完整恢复须重新下载/hash及Range对比；片段是人工对时与播放器定位，不是转码剪辑。微信关闭的fresh生产模式库可能无身份行，不把空表恢复或0行quarantine写成真实微信身份恢复验收。

真实商户支付、退款及商户日账单，实际小程序AppID/域名/基础库/iOS/Android，第三方直播/转码/大媒体存储，原生OBS/CEF均未联调。保险文件只提供私有资料上传下载，不代表承保或保险审核集成。未改正式账号、正式数据库，无付费资源或外部新凭据。

旧001–011未改。既有C02旧库升级fixture主要是合成旧用户；尚缺旧001–007完整FINAL比赛状态的升级fixture，本批不把新空库迁移或完整同版本恢复冒充这项跨历史业务升级证据。


## 最终候选日志与审查

run40001590258：admin120578770233、api120578770362、production120578769934。914源码、VM11与12Mock独立列；238常规PG＋16最小权限/生产PG＝254，不与504API源码重复计数。实际capture→重启→verify核58表；production可信HTTPS启用ENFORCED，复用正式编译产物走HTTP，含双人合成人工收退款、GROUP完整链及真实PDF/PNG/H264MP4字节/Range。媒体头严格单个nosniff通过，未放宽断言。完整备份停所有源写者后执行，第二实例/卷恢复精确58表与业务快照，旧会话/公开/overlay/平台人员/媒体授权隔离；拒覆盖和故意失败owned清理保留control。

必要独立审查已在最终source全日志后CLEAR。原自动P2（GROUP表单强制加时）已修复，4组件回归及真实GROUP链通过，对应线程resolved/outdated；9abeb5c8自动CodeReview仍RUNNING，不写成自动审查通过；security未运行。后续以实际PR状态更新。


## 合并后独立运行（2026-10-23T18:45Z核验）

run40003519494，push head d4f6500453f293499dcc0d189c084156026db4f1，run_attempt=1，overall SUCCESS。admin120585474543 / api120585474946 / production120585474817均SUCCESS，完整日志已取回核对。源码410+504、VM11、12Mock；API 238/238真实PG、58表capture→真实重启→verify、桌面12及手机模拟12各3.7分钟、正常及故意失败owned清理保留control；production16PG/可信HTTPS4、精确58表与实际媒体字节/Range、API换IP/Web不变、停源写者后完整dump至第二实例/卷/快照fence、拒覆盖及旧授权隔离全部通过。首次浏览器安装耗时5分40秒后成功，无取消、无重试、未放宽断言。

后续纯文档同步遵守workflow paths过滤，没有声称文档提交另跑应用CI；业务代码与该合并SHA一致。自动CodeReview仍标RUNNING（最新状态以PR为准），必要独立审查与原P2修复已完成；security未运行。
