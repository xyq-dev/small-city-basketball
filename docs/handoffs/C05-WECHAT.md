# C05 微信身份与原生小程序

2026-10-24（Asia/Shanghai）；负责人/root/c04_domain；REVIEW / BRANCH_ONLY。目录/workspace/scratch/dc6a786e1a31/c05-wechat，分支feat/C05-WECHAT，基线ead3a62。已读AGENTS/C05任务、现场核验origin原仓库；开工只有3个未追踪依赖symlink，保留不提交。只写本模块独占新增文件；app.ts/App.tsx/service/runtime-config/index/manifest/恢复/CI由root接线，不重复修改。

## 实现与接口

独占合同packages/contracts/wechat.d.ts（root统一export）。WechatController/SCB_WECHAT_SERVICE，构造WechatService(pool,apiOptions,{configuration,exchange?})。配置helper readWechatConfiguration：WECHAT_MINI_LOGIN_ENABLED默认false；启用须完整WECHAT_MINI_APP_ID与WECHAT_MINI_APP_SECRET[_FILE]，不生成真实凭据。禁用capabilities明确关闭；不创建虚假用户/邮箱/密码、不按昵称/unionid合并。

- GET /v1/auth/wechat/capabilities；GET /binding（当前登录账号）。
- POST /challenges {purpose:LOGIN|BIND,consent:true,password?}：BIND要求当前会话、密码重新验证，5分钟一次state；LOGIN不收应用密码。
- POST /login、/bind {challengeId,state,code,consent:true}；challenge先事务原子claim并写唯一AppID scoped code hash，随后在事务外exchange，成功/失败后都不能再次exchange。绑定challenge绑定原session、user、当前密码指纹；密码维护/注销/更换会话后拒绝。
- POST /unbind {password,expectedVersion,consent:true}：重新核验密码和版本，撤销身份及该用户全部sessions，清除cookie。原账号维护advisory锁共享登录/绑定、解绑用exclusive，全部在session/user行锁前取得；避免会话创建漏出维护撤销与两个会话解绑互等。
- 复用原createSession/sessionData/lockActor/rateLimit/audit，不扩大机构权限；新增每账号密码复核限流。每个AppID+openid哈希唯一且永久不转移至其他用户；同用户同AppID最多一个ACTIVE，可本人明确重新绑定已撤销身份。
- 官方transport固定https://api.weixin.qq.com/sns/jscode2session，无URL配置入口、redirect:error、5秒AbortSignal、响应最多8192bytes；不日志/下发/持久rawopenid、code、session_key、unionid、secret或带凭据URL。测试exchange显式注入，不当作真实微信验证。

014_c05_wechat.sql新增wechat_identities和wechat_auth_attempts，旧001–013不改。DDL已编写，本worktree未执行。身份所有者/key/创建时刻不可改、状态切换须version+1；attempt只PENDING→CLAIMED→COMPLETE/FAILED，state/app/purpose/actor不可改。运行最小权限交root：identities SELECT/INSERT、UPDATE(status,version,updated_at,revoked_at)；attempts SELECT/INSERT/DELETE过期清理、UPDATE(code_hash,status,claimed_at,finished_at)。清理bounded100行SKIP LOCKED且保留10分钟过期缓冲。恢复quarantine须撤销ACTIVE identities并version+1、离线DELETE全部attempts；已通知root。

## Web与原生入口

WechatAccountPage({client?,onSignedOut?})给root路由/account/wechat：查看状态、原生小程序绑定指引、密码+明确勾选后解绑并退出全部设备；不伪造浏览器wx.login。晚到响应/组件卸载后不能退出后来账号。API client重建字段白名单。

apps/wechat是原生、无外部依赖源码，project.config为touristappid占位（不能发布/真实登录）。4页：公开观赛键入口、完整分页赛程/循环积分/分组groups与淘汰签位/最终名次、单场原比分与权威锚点计时/公开媒体及片段定位/外链说明、已有账号密码登录与显式微信绑定登录/解绑。分享只含原opaque grant/match键；不自动公开私有赛事、不提供管理写入、不存AppSecret。SID从响应显式提取，仅模块内存，发送固定Origin与Cookie；禁用时不假成功。

404撤销清空旧赛事/榜单/媒体；断网标记旧数据陈旧，前台轮询/显式刷新恢复，写操作不自动重放。第三方公开地址仅用户操作复制且保留不可由本站撤回声明；不保证微信播放。受控自持内容走原publicgrant媒体URL，不绕过授权。

## 实测与待验

本机通过：API/admin strict；API/admin build（Web旧entry尚由root接线，最终整合bundle另验）；provider单测8、Web界面4、原生client/VM页面8，共20项；原生JS node --check与JSON解析；格式与diff-check。源码unit/VM是显式模拟transport，不是PG/浏览器或微信开发工具。

新增11项真实HTTP+PG集成已编写，使用createApi({...,wechat:{configuration,exchange}})显式注入传输：默认关闭/Origin、密码与consent、participant复用/跨机构/无raw存储、无绑定不建号、并发state/code重放、session/密码指纹/过期、AppID隔离/唯一绑定、解绑全session撤销、audit失败原子回滚、并发抢绑/返回AppID错误、传输失败burn。本机无PG，未执行；root隔离CI才可记实测，不能预标通过。测试合成身份直接seed但真实HTTP登录，不消耗注册限流、不弱化prod guard；过期case插入合成已过期PENDING，不禁用触发器。

真实微信官方页面本轮获取受限；实际主体资质、AppID/secret、合法request/download域名、开发工具、目标基础库Origin/Cookie行为、真机分享/媒体/微信审核发布均未验证。源码已形成可验收产物，不等于已上线小程序。无生产部署/真实DB/正式账号修改、付费资源、新外部凭据或公网端口。

## 接续

root按本提交整合，接入共享出口/controller/options/账户路由/运行ACL与恢复quarantine；CI额外运行node --test apps/wechat/test/*.test.cjs及新JS语法/JSON；联合跑全部strict/build/真实PG/真实桌面手机模拟HTTPS/完整恢复。微信真实凭据不在本轮配置范围，未配置功能必须继续disabled。原生微信/OBS/真实付费链路不从模拟测试推断完成。


独立复核增量：已修快照响应先记receivedAt，媒体慢请求不拖后时钟；媒体失败单独清旧媒体而保留已更新比分，404仍整页清空。Cookie提取兼容wx响应cookies[]与Set-Cookie并拒冲突SID，仍仅内存。新增3项原生回归，原生共11项通过；真实基础库行为仍待验。由单独fix提交交root整合。

## 官方 wx.request 协议核查（独立只读增量）

2026-10-24（Asia/Shanghai），只读，没有改网络/CSRF代码或配置微信凭据。两搜索引擎限定developers.weixin.qq.com检索未得可读条目；以下官方中/英文页面实际open均返回工具non-retryable/不可读取，不能按社区转述补成已读规范：

- https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html
- https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- https://developers.weixin.qq.com/miniprogram/dev/api/network/request/RequestTask.html
- https://developers.weixin.qq.com/miniprogram/en/dev/api/network/request/wx.request.html
- https://developers.weixin.qq.com/miniprogram/en/dev/framework/ability/network.html

可读取的微信官方primary源为wechat-miniprogram/api-typings（文件Tencent版权）。通过GitHub只读API核验当时master HEAD为`6092df9100c73b84e140c20b9a42a8e8799e0660`（提交时间2026-09-01T12:25:38Z），对应[固定提交](https://github.com/wechat-miniprogram/api-typings/commit/6092df9100c73b84e140c20b9a42a8e8799e0660)。[该SHA README](https://raw.githubusercontent.com/wechat-miniprogram/api-typings/6092df9100c73b84e140c20b9a42a8e8799e0660/README.md)实际读取成功，说明API声明和官方文档同源自动生成。未安装这个包或改变锁文件。

[官方API声明master原文件](https://raw.githubusercontent.com/wechat-miniprogram/api-typings/master/types/wx/lib.wx.api.d.ts)实际可读；对应固定审阅链接为[6092df9 API文件](https://github.com/wechat-miniprogram/api-typings/blob/6092df9100c73b84e140c20b9a42a8e8799e0660/types/wx/lib.wx.api.d.ts)。注意大文件固定SHA raw读取因工具体积/DisabledError被拒；下述条目直接来自已读master原文件，未声称完成该大文件固定blob字节校验。

- RequestOption（读取时L10720起）的header说明在L10766–10769：仅明确不能自定义Referer，类型为IAnyObject；没有列出Origin/Cookie禁止项。
- RequestSuccessCallbackResult（L11049起）在L11055–11058明示cookies为字符串数组且基础库最低2.10.0；L11065–11068提供response header（最低1.2.0）。这支持客户端同时解析cookies[]与Set-Cookie的必要性，不代表已验所有平台Cookie行为。
- RequestTaskOnHeadersReceivedListenerResult（L11081起）也有cookies[]；其statusCode说明提示开发者工具与真机可能不同，进一步不能把VM/工具结果等同真端。

结论严格限定：已读官方声明未给出“Origin明确禁设”的证据，但不能由未列禁止项推断iOS/Android/各目标基础库一定原样发送手动Origin/Cookie。当前未确认必须更改协议，保留全局Origin/CSRF严格校验，微信默认关闭。不得增加Referer白名单或仅凭X-Client头跳过全局鉴权，也不能把来源头视为用户/机构授权。

真实启用前须用正式AppID对应的开发工具及至少目标iOS/Android基础库，在受控HTTPS隔离环境实测实际送达Origin、Cookie及cookies[]/Set-Cookie读取，覆盖密码登录→绑定→微信登录→注销/解绑撤销，以及缺失/外域Origin仍403；只记录布尔状态/请求ID，不打印临时code、sid、AppSecret/session_key或敏感请求体。当前没有真实微信/真机或此项网络实测，不能将本官方源阅读升级成协议验收通过。
