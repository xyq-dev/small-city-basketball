# C05 验收证据

2026-10-24（Asia/Shanghai）；root。PR13分支验收中，未合并或生产部署。最终完整验收尚未通过，不以本地、作者报告、协议fixture或失败轮的局部通过替代。

| 轮次 | source | CI | 实际结果 |
| --- | --- | --- | --- |
| 1 | 19212ce | [39996944016](https://github.com/xyq-dev/small-city-basketball/actions/runs/39996944016) | 三job失败；012裸CASE导致PG42601，API及production迁移被阻；opsREADME格式失败 |
| 2 | 1a467042 | [39997736172](https://github.com/xyq-dev/small-city-basketball/actions/runs/39997736172) | admin成功：908源码+11VM、12Mock、strict/build/format；API198通过/2失败/36跳过，production16PG通过后角色维护审计NULL actor失败；测试file共享登录IP预算也导致429 |
| 3 | d9b8454 | [39998592777](https://github.com/xyq-dev/small-city-basketball/actions/runs/39998592777) | API237/238通过，仅成员fixture期望404实403；production16PG通过并推进TLS媒体下载后，driver断言把字符串传assert.match中断。admin完成910源码+11VM/strict/build/format，Chromium安装慢；后因第四轮普通推送按并发规则CANCELLED，未执行浏览器 |
| 4 | 16e5697 | [39999662348](https://github.com/xyq-dev/small-city-basketball/actions/runs/39999662348) | admin SUCCESS（914源码+11VM、12Mock/strict/build/format）；API SUCCESS且完整日志已核：238真实PG、58表实际PG重启验证、桌面12/手机模拟12真实API浏览器及正常/故意失败owned清理通过；production16PG通过后媒体下载严格头断言发现nosniff重复，故FAILURE，尚未完整恢复 |

修复逐项：012CASE整体括号；两处审计在同一财务/维护事务插入DISABLED系统用户以满足原NOT NULL/FK（不放宽DDL/ACL）；测试每file恒定真实loopback TCP来源，应用限流及代理信任不变；商业fixture显式证明成员403/非成员404；no-store用严格RegExp断言；自动审查P2使GROUP记分表单固定加时，并保留RR平局，新增4组件回归；nginx隐藏上游重复的X-Content-Type-Options，由边缘保留单个nosniff always，API直连头与严格断言不变，真实nginx待下一轮。失败及被替换任务不当作成功，不拼接不同source片段。

## 证据边界

源码/JSDOM与小程序VM不代表真实浏览器、微信或支付；Native协议用合成RSA/AES及受控transport，微信身份用注入exchange。真实PG项使用隔离PostgreSQL18.6；production job指隔离的生产模式可信HTTPS包，不是正式服务器部署。桌面/手机项目采用Chromium（手机模拟，非iOS Safari或微信真机）。媒体合成PNG/MP4/PDF含实际字节，完整恢复须重新下载/hash及Range对比；片段是人工对时与播放器定位，不是转码剪辑。微信关闭的fresh生产模式库可能无身份行，不把空表恢复或0行quarantine写成真实微信身份恢复验收。

真实商户支付、退款及商户日账单，实际小程序AppID/域名/基础库/iOS/Android，第三方直播/转码/大媒体存储，原生OBS/CEF均未联调。保险文件只提供私有资料上传下载，不代表承保或保险审核集成。未改正式账号、正式数据库，无付费资源或外部新凭据。

旧001–011未改。既有C02旧库升级fixture主要是合成旧用户；尚缺旧001–007完整FINAL比赛状态的升级fixture，本批不把新空库迁移或完整同版本恢复冒充这项跨历史业务升级证据。
