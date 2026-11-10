# MEMBER02 最终验收证据

**DONE / MAIN：机构会员后端与响应式Web首版；生产未部署。** [PR54](https://github.com/xyq-dev/small-city-basketball/pull/54)已普通merge至main `fee705bae05c1b987f80777d196c39eb2cf4c58b`。source `04415dc02af097c568bd7d7897228364bfb45361`、CI测试merge `7714fdb887cfee91f77218e58065d89423250c3e`、本地源 `6113bb22c4f72aa4b9810fea3ed9cb6170f731af` 和实际合并tree均 `da8f6dabdfe572fbf47c3f491a9fad63f96f277c`，已分别实际读取核对。main843祖先、M1全部事实和已有工作保留，无force。

[CI258 / run42799254368](https://github.com/xyq-dev/small-city-basketball/actions/runs/42799254368)同source四作业全部SUCCESS；root与独立审查者各自读取完成日志。源/测试/合并SHA、精确job、计数和原始片段见[ci258-summary.json](ci258-summary.json)。主线merge后的自动复跑另列，不能把进行中或未核验运行算成功；后续归档只改docs，不改已验收应用文件。

| 证据层 | 实际范围与结果 | 边界 |
|---|---|---|
| 本地直接检查 | 最后API/UI76、完整type/Webbuild/格式通过；此前完整format/type/build/源码与pure恢复6通过 | 组件响应Mock不是PG/商户实证 |
| CI源码与构建 | admin789/API1457；微信1638+1平台skip；CLI12；storage11+1环境skip；全仓格式/类型/构建成功 | 平台/UID环境skip明确保留 |
| 真实会员PG | member17+Native9=26；真实SQL、精确周期、全期额度、并发最后一届/退款、闭单证明、微秒衔接、安全续单与权限通过 | RSA/AES与transport合成，不是真实微信资金 |
| PG隔离/故障 | 随机owned专库；固定child23；只普通DROP自己创建且OID一致的库，原控制库全账本/firstRun指纹不变 | 原C05全商户账单断言未放宽 |
| R6/旧组 | R6147；原组641全部通过（含6历史源守卫）；C22原22schema升级5、本单消费注销14含新增case通过 | 不能把641全称实际PG，也不代替旧007生产非空升级 |
| 新会员真实浏览器 | ENFORCED真实API/PG，桌面1440×1040与手机Web390×844各1：建议零写、不可变发布、买方核对、独立收款、首次原发布扣额、用量/刷新/原采购分流、正确方案顺序 | Node test-mode真实API，非响应Mock、非微信真机或实付 |
| 原客户端与重启 | 原生页面JS→真实HTTP21；实际PG restart+verify；原API桌面12+手机12；三suite故意失败owned清理全部通过 | 原生页面测试不是微信运行时，新原生会员页未编写 |
| 隔离生产模式 | runtime PG21；真实TLS/Cookie4浏览器；原HTTP年期付款/停售后RR用1剩35；同卷换IP保留Web会话；228表完整dump→第二PG精确恢复/旧授权隔离/owned清理 | 临时生产模式镜像，不是生产部署 |
| 账号安全 | HTTPS桌面1/手机1、三suite故障清理通过 | 不表示修改了真实管理员资料 |
| 兼容布局 | 浏览器1581通过/1567原配置skip，1566原生静态兼容布局及PNG守卫 | 非微信开发工具或真机 |
| 审查 | 独立金融/锁序/精度/隔离/C22 Git逆向源与最终delta通过；两P2实际回归且resolved；自动code_review精确044 completed无finding | 未另跑自动security_review |
| 图像检查 | 四张最终原图校验、root/Web作者分别实际看图，专业优先差异已修，无阻断遮挡/全页横向溢出 | [差异与范围](VISUAL_REVIEW.md)，不称像素一致或全部13态图像验收 |

## 原始图与来源

[桌面方案](desktop-api-plans.png) · [桌面用量](desktop-api-usage.png) · [手机Web方案](mobile-api-plans.png) · [手机Web用量](mobile-api-usage.png)。四图是合成业务数据的真实API页面，不是效果图或生产截图。

artifact `13755024682`，ZIP 1653188字节，SHA256 `ad286b13dc9f6e0c1b618a13f461b12f0c2a0abfa1cc5cf78b20c3278c307fb9`；逐字节验证后保存原图。尺寸/DPR/字节/hash见[screenshots.json](screenshots.json)。全页图高于视口是纵向内容，未裁剪/缩放证据。

## 失败与修复历史

CI251首次052语法失败、CI252参数类型与旧C22夹具失败已最小修复；CI254会员25通过后因组顺序抢占firstRun失败，恢复R6先执行。CI255局部成功后由安全续单P2修正替换，旧结果不替代新条件。

CI256/source2332/treeb205的会员26和其余三作业成功，旧组640/1失败（总641含6历史源守卫）：新Native测试污染共用完整商户账本，7个LOCAL_ONLY为正确检测。修复owned专库及控制账本指纹保全，未按机构过滤生产对账或删除原断言。

CI257/source094、测试merge66f5/tree f845：会员26、R6147、新会员各1、旧组完整641通过，随后因修正Figma排序的新候选被concurrency取消；NativeHTTP/重启/原API浏览器未在该轮继续。四张旧图不能追认为修正后图。最终CI258同source重新完整通过。[全部检查点](../../tasks/MEMBER02.md)、[交接](../../handoffs/MEMBER02.md)保留。

## 未执行与恢复

052已编写并在隔离PG执行，001–051字节保持，生产Migration0。未生产部署/改正式数据库或账号/发布价格/用真实资金、新外部凭据、付费资源或公网端口。原生新会员页仍为已确认Figma；真实商户、本机JSAPI会员支付、微信/Safari真机、OBS客户端、发票/合同、旧007生产库非空升级演练不在本卡完成范围。一个未决Native续单负向为显式SQL admission夹具，不冒称真实支付发起。

收尾时本地运行环境连接中断，源码合并及四job成功已先完成，截图原字节已创建并校验远端Git blob；通过GitHub继续只归档docs与原证据。最后可核验本地HEAD6113bb2、feat/MEMBER02-integration，有本轮docs/证据未提交修改；断线后不能声称工作区干净。恢复时先保留本地修改再核验最新main，不重建项目，不reset/clean/force。
