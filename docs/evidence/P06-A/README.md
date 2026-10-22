# P06-A 验证与界面证据

更新：2026-10-22。REVIEW／BRANCH_ONLY，首CI功能已全通过，文档修正后的最终head／MAIN尚待验收。

| 文件 | 页面 | 尺寸 |
|---|---|---|
| [management-1440.png](management-1440.png) | 机构单场包装预览与授权状态 | 1440×2007 |
| [management-390.png](management-390.png) | 手机轮换授权确认弹框 | 390×1000 |
| [source-1920.png](source-1920.png) | 独立透明比分浏览器源 | 1920×1080 |

这些图片全部是合成HTTP布局，不是真实赛果或原生OBS连接证据。scratch preview-overlay.mjs在同父进程启动Vite和nativeChromium153.0.8010.0；Noto Sans SC仅临时注入QA，不新增产品依赖。root和UI实施者已目视三图，生成时没有secret／session／个人真实资料。

普通及60字符连续ASCII队名分别检查1440／390的赛事选择、单场管理、轮换弹框，以及1920的已准备／未准备源，共16状态；另普通名坏FINAL预览1440／390与终态1920，合计19。无横向页面溢出、按钮截断、pageerror；独立源无auth/org/invitations请求，body透明。手机输入16px，桌面原机构选择器13px。独立UI静态复核CLEAR。透明PNG为RGBA，corner(0,0) alpha=0、比分条(960,900) alpha=255；仅证明浏览器渲染透明，不证明OBS/CEF合成。

本地源码372（admin171/API201）、完整strict、格式／两端build及native153的12Mock通过。原302源码保留，新增70（UI24/API46）。006独立静态CLEAR且hash94a54d6ae997774fd9b511dd39f5d4e1596b71c97384f2162e5c1dd8a7a39be6，未执行本地PG。新增17项PG源码保留原106，预计123；真实39表重启／14API浏览器及原有失败子库清理待CI。CI结果不能由这些截图或测试计划替代。


## 首CI真实验证

首CI39756976748在远端source7ba9d01bb46d8c4b7a5ce72081aef50719d05539（tree52f2681a727b9a5ea4944c6019a8f0eaa0cda8cd）全部成功：372源码（admin171/API201）、123独立PG（原106＋17）、12Mock＋桌面7／手机7真实API、格式／完整strict／build、001→006与checksum、实际PG18.6重启及39表完整指纹、正常及故意失败子库清理。官方Chromium151.0.7922.34。 job119751331489及119751331716均success，完整日志已读。新增场景实际通过无public赛事签发、StrictMode fragment/Cookie刷新与新context原URL授权、透明corner alpha、真实老化时钟只扣一次、确认／重开、轮换／撤销清屏、实际1分钟TTL、断网30秒清屏／恢复及迟到响应不复活。PG新增17含INSERT FK等待跨截止404／无残留，重启保留旧secret/session永久失效、精确到期及全部39表。上文待执行为首CI前历史，不能抹掉这一区别。下一候选仅MD修恢复点，仍需当前head最终CI后合并；截图始终仅合成布局，原生OBS／CEF、生产或备份恢复尚未验证。
