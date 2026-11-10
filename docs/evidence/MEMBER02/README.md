# MEMBER02 验收证据

当前为REVIEW候选，不是生产发布记录。主源码：[PR54](https://github.com/xyq-dev/small-city-basketball/pull/54)，远端2332f9fb6b1c46dadc86a943f23803df7d134eb2，tree b2057f0e57571f3d7baa7e520a4f93f2420e1254；root本地fb2dec5相同tree。测试merge6d461790a8a3ffdbbc3ff9f71194e6aa72eb86df已实际读取相同tree，保留M1 main cd8ed1f祖先。

[当前CI256](https://github.com/xyq-dev/small-city-basketball/actions/runs/42791070234)结果为FAIL：会员26与三组作业通过，旧组因测试账本污染失败；新专库runner/前置guard/collect修复尚待下一head完整CI，禁止把下方局部成功拼成全绿。完整失败历史及源提交见[任务](../../tasks/MEMBER02.md)和[交接](../../handoffs/MEMBER02.md)。

| 证据层 | 精确环境与范围 | 当前候选结果 |
|---|---|---|
| 本地源码 | format/type/build；admin787/API1457；微信1638+1平台skip；CLI12；storage11+1UID环境skip；恢复pure6；最新领域24 | 通过，不是PG/商户证据 |
| CI真实会员PG | member17+Native9，合成RSA/AES、受控transport；真实SQL/HTTP/锁/全期额度/退款/关闭证明/微秒/安全续单 | 26/26通过，已读完成归档日志 |
| CI原R6 | 原共享空库首次初始化后147项 | 147/147通过，已读归档 |
| CI旧组/旧库升级 | 旧组含冻结历史source guard、C22原22schema与全升级、注销本单消费回归 | 旧组640通过/1失败；C22升级及注销新增通过，唯一Native完整账单因共享fixture污染报7个LOCAL_ONLY |
| 真实API浏览器 | 原API桌面12/手机12；新增会员桌面1440×1040、手机390×844采购/独立收款/发布扣额/用量刷新 | 待完成 |
| 隔离生产模式HTTPS | 实际非root镜像/最小身份、原HTTP收款年期、停售后原RR消费1/剩35、228表完整dump→第二PG精确恢复/旧授权隔离/owned清理 | 当前candidate production129744487179已成功，完成日志已读 |
| 账号安全 | 原两端可信HTTPS身份流程与三suite故意失败owned清理 | 当前candidate account-security129744487043已成功 |
| 源码/兼容浏览器 | 全仓必要检查、原兼容布局/PNG守卫 | 成功：787/1457源码、1581兼容浏览器、1566布局PNG守卫 |
| 代码审查 | 各核心/delta及C22原Git逆变换独立复核 | 无未解决源码P1/P2；两自动线程待相关PG实证收口 |
| 真实外部/生产 | 微信商户实付、微信/Safari真机、原生新会员页、OBS、正式部署/数据库/价格发布 | 未执行；原生会员仅Figma设计 |

Migration052已在隔离测试库执行；001—051原文未改，生产执行0。Native续单的一个未决渠道负向使用显式SQL admission夹具，其余签名Native回归不等于真实微信商户。浏览器为模拟设备，不是原生小程序。

新增测试隔离与浏览器preflight：owned PG脚本保留原全账本严格断言，负向失败必须23且control OID/指纹不变；会员外层canonical guard在Pool前执行。官方维护模块本树编译后native动态导入，避免测试CJS重写import.meta。真实collect/9项guard与type/build通过，仅证明该层，下一候选真实流程尚待。
