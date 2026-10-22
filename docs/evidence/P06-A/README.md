# P06-A 验证与界面证据

更新：2026-10-22。REVIEW，完整源码本地整合，尚无本卡真实PG／重启／API浏览器或MAIN证据。

| 文件 | 页面 | 尺寸 |
|---|---|---|
| [management-1440.png](management-1440.png) | 机构单场包装预览与授权状态 | 1440×2007 |
| [management-390.png](management-390.png) | 手机轮换授权确认弹框 | 390×1000 |
| [source-1920.png](source-1920.png) | 独立透明比分浏览器源 | 1920×1080 |

这些图片全部是合成HTTP布局，不是真实赛果或原生OBS连接证据。scratch preview-overlay.mjs在同父进程启动Vite和nativeChromium153.0.8010.0；Noto Sans SC仅临时注入QA，不新增产品依赖。root和UI实施者已目视三图，生成时没有secret／session／个人真实资料。

普通及60字符连续ASCII队名分别检查1440／390的赛事选择、单场管理、轮换弹框，以及1920的已准备／未准备源，共16状态；另普通名坏FINAL预览1440／390与终态1920，合计19。无横向页面溢出、按钮截断、pageerror；独立源无auth/org/invitations请求，body透明。手机输入16px，桌面原机构选择器13px。独立UI静态复核CLEAR。透明PNG为RGBA，corner(0,0) alpha=0、比分条(960,900) alpha=255；仅证明浏览器渲染透明，不证明OBS/CEF合成。

本地源码372（admin171/API201）、完整strict、格式／两端build及native153的12Mock通过。原302源码保留，新增70（UI24/API46）。006独立静态CLEAR且hash94a54d6ae997774fd9b511dd39f5d4e1596b71c97384f2162e5c1dd8a7a39be6，未执行本地PG。新增17项PG源码保留原106，预计123；真实39表重启／14API浏览器及原有失败子库清理待CI。CI结果不能由这些截图或测试计划替代。
