# C08 实现与验收证据

2026-10-24 Asia/Shanghai；原生源码已合并main；最终候选验收通过，不代表微信官方运行或生产部署。

| 范围 | 已执行结果 | 边界 |
|---|---|---|
| 原生Page/Component/模型/transport VM | 最终225/225通过 | 真实项目JS，wx为显式隔离模拟，无网络 |
| 原生WXML结构/事件/路由/组件模板 | 21路由及49项专用检查通过（包含于201） | 兼容语法子集，不是官方编译器 |
| Web单元 | 完整512/512（maxWorkers=2） | 首次高并发508/512，3超时1时序失败保留 |
| API单元 | 534/534 | 本轮未改后端契约或业务 |
| format/typecheck/build | 通过 | 真实WXML官方编译不在此命令范围 |
| 真实模板离线Chromium布局 | 90/90实际通过，三宽各30；90组PNG/JSON数量/尺寸守卫与下载核验通过 | 21初始+9填充×三宽；非微信运行时 |
| 第一轮CI40091273371 | admin成功，production失败，api当时运行 | 整轮不是全绿，不作为最终候选验收 |
| 微信开发工具/真机/外部认证/媒体 | 未执行 | 缺目标AppID/合法域名和客户端环境 |
| 后端业务/新Migration/生产 | 无源文件变更或生产操作 | 既有Migration仅在隔离CI执行，CI名production不是生产部署 |

独立审查各域后共修复账号迟到code、审核版本、机构意图、筛选纠错、清命令前最新记录和读取journal未知六项P2；每项直接回归并由其他作者只读复查。另首轮隔离包发现CI helper将初始化期Unix socket误作TCP ready；只修探测主机，保留预算和一次provision。没有修改断言/超时来获得通过。

首轮失败、提交映射和Git Data相同tree核验在[任务](../../tasks/C08.md)；统一人工检查在[交接](../../handoffs/C08.md)。最终CI原始日志、截图和审查状态接续更新，不引用旧C06/C07结果替代新实现验收。


## 已核实的原生兼容布局文件

候选`96aa0af6192202b2b381c58f718c6dd10c69cbab`，tree `49b17f4d47306df7abe1c687fee75b60fa71645d`；[CI40094090818](https://github.com/xyq-dev/small-city-basketball/actions/runs/40094090818) 三个job全部SUCCESS，attempt1，无重试；原始日志已逐项核对。PR15合并main0d35d4608c59015a14a60926769c162cbeb5c362，合并tree与此候选一致。

实际下载artifact `12559769583`，ZIP SHA256 `902454e6e340bfd4a65b9cab7ee3671d95174c82c82c67fdac35cf97aa166094`与GitHub digest一致；核对90份原件JSON和90份原件PNG，三宽各30、PNG均844高。完整尺寸记录见[layouts.json](layouts.json)，8张代表图的源路径/哈希见[screenshots.json](screenshots.json)，PNG字节未改动。

这些图片来自真实WXML/WXSS的离线Chromium兼容渲染，数据均为合成；头部、控件、字体与安全区存在适配近似，**不是微信运行时、开发工具或真机截图，也不是99状态逐像素签收**。已抽查首屏/底部、第三人横滑和费用/声明的可达性；所有90例检查通过不代表全部业务状态已在真实微信验收。

| 页面 | 390px代表图 |
|---|---|
| 首页 | [home-390.png](home-390.png) |
| 选人/筛选 | [players-390.png](players-390.png) |
| 球员数据，保留真实0 | [player-390.png](player-390.png) |
| 同价含费/有限样本对比 | [compare-390.png](compare-390.png)，[320px](compare-320.png) |
| 五种模式及建单 | [booking-create-390.png](booking-create-390.png) |
| 逐场履约与变更 | [booking-detail-390.png](booking-detail-390.png) |
| 本人资料/档期 | [player-center-390.png](player-center-390.png) |


## 最终同一候选的完整结论

CI40094090818 / source96aa0af：三个job全部SUCCESS，attempt1。Web512/API534/原生VM225；90布局+14Mock（重复mobile90例skip，原mobile业务测试继续运行）；289真实PG+隔离包16，桌面12/手机模拟12真实API。65表实际重启/完整恢复、旧授权隔离/TLS、正常及故意失败owned清理通过。自动CodeReview最新source completed无finding/未解决finding；所有旧finding已修复resolved，security未运行。

首轮六项独立问题后，又统一修复球队/报名/上传/撤销以及账号声明、平台审核/费率与数据授权预检期间的编辑隔离。最终225项原生VM和独立重放均通过。历史40091273371、40091687136、40092193443、40092391471、40092661219、40093165424和40093470917保留各自失败/取消/阶段通过边界，详见任务卡；最终结论只使用40094090818，没有把局部成功拼接为一次全绿。

候选与合并代码tree一致；后续仅文档、这些原图和JSON同步。合并后自动CI尚未取得最终结论，不以候选检查冒称重复执行。微信官方运行与用户统一验收仍待目标环境。

合并后[自动CI40095117969](https://github.com/xyq-dev/small-city-basketball/actions/runs/40095117969)在本次读取时仍为in_progress；候选CI通过与合并后重复运行分列，未冒称后者已通过。其后仅同步文档和这些原图/JSON，无应用代码变化。
