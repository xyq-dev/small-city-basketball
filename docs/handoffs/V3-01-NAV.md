# V3-01-NAV 交接记录

## 上下文

- 更新时刻：2026-11-02 Asia/Shanghai，完整性检查之后
- 负责人：当前 Cursor 会话
- 本轮工作区：`D:\Projects\small-city-basketball-v3-nav`
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`
- 分支：`ui/v3-main-nav`
- HEAD：`b1e6c9f2c27cd60563fde24fbf62d239bb003c9e`（与基线相同，视觉改动未提交）
- 原首页工作区：`D:\Projects\small-city-basketball`，分支 `fix/wechat-homepage`，同一 HEAD；未跟踪只剩 `scb-homepage-assets-v1/` 与 `scb_remaining_ui_v3/`。本轮没有切换、覆盖、清理或重置
- 微信工程：`D:\Projects\small-city-basketball-v3-nav\apps\wechat`
- `project.config.json`：`miniprogramRoot` 为 `./`，`appid` 为 `touristappid`，`urlCheck` 为 true。开发者工具曾把真实 AppID 写入该跟踪文件，已还原；真实 AppID 只留在被忽略的 `project.private.config.json`，不提交、不在记录中抄写
- 状态：IN_PROGRESS / LOCAL_ONLY
- commit、push、pack、部署、Migration、生产数据：本轮均未执行

## 对照结果

对照 HEAD 模板、当前模板、`boards/01.png` 和现有页面接口后，四页原有 `bindtap` / `catchtap` 和原有静态文案没有丢失。新增的只有赛事、同城顶栏的搜索与消息跳转，以及赛事英雄区滚到目录。

`origin/main:docs/design/REMAINING_PAGES_VISUAL_V3.md` 已阅读。它把 72 张图定义为视觉参考，不是已实现界面，也不是验收基准。第一组就是这四个主导航加切城、搜索；切城和搜索本轮不改版。

## 本轮修复

- 同城 320px 英雄按钮被固定高度裁切：英雄文案改为文档流撑开高度，`components/v3-chrome/visual.wxss`。
- 未登录“忘记密码／验证邮箱”被底部操作条盖住：该块增加 `account-guest-links`，页内底部留白加大，`pages/account/index.wxml` 与 `index.wxss`。登录输入增加 `cursor-spacing="160"`。键盘遮挡未在模拟器里实测。
- 球队成员数在 `members` 缺失时不再读取 `length`，`pages/teams/index.wxml`。本轮微信没有读到球队列表，该分支未在模拟器出现。

## 微信开发者工具

开发者工具 2.02.2610302 的当前工程是 `D:\Projects\small-city-basketball-v3-nav\apps\wechat`。自动化端口 9420。四页 `reLaunch` 均返回页面数据，没有组件找不到或未捕获异常。

模拟器页面数据：

- 赛事：`signedIn=false`，阶段 `LIVE`，列表 0 条，错误为“网络连接中断，请恢复连接后刷新；原操作结果可能尚未核对。”
- 同城：供给类型 `COURT`，列表 0 条，同一网络错误。页面保留“尚未设置距离起点”，没有造假米数。
- 球队：`loginRequired=true`，列表空，同一网络错误。
- 我的：`user=null`，`loading=false`。未登录界面，五栏导航按原规则隐藏。

元素文本确认搜索、消息铃、三阶段、公开招募、观赛链接、我的赛事、切城、找附近、我的预约、四种供给、地图、球队广场、申请建队、加入码、忘记密码都在编译后的页面里。没有逐项点击，也没有验证返回。

控制台仅有既有警告：`pages/recruitment/index`、`pages/public-archive/index` 的 `enableShareAppMessage`，以及离开首页时的性能提示。截图：

- `D:\Projects\scb-ui-review\v3-nav\2026-11-02-1315\wechat-watch.png`
- `D:\Projects\scb-ui-review\v3-nav\2026-11-02-1315\wechat-local.png`
- `D:\Projects\scb-ui-review\v3-nav\2026-11-02-1315\wechat-teams.png`
- `D:\Projects\scb-ui-review\v3-nav\2026-11-02-1315\wechat-account.png`

账号页滚到恢复入口时，自动化 `pageScrollTo` 超时，没有滚动态截图。真机未执行。

## 浏览器静态预览

Playwright Chromium 打开 `native-preview` HTML，使用合成夹具，不是微信。修复后的 320 / 390 / 430 图在：

`D:\Projects\scb-ui-review\v3-nav\2026-11-02-1315\browser\`

文件名：`watch|local|teams|account` 的 320、390、430，以及 `watch-error-390`、`local-error-390`、`teams-login-390`、`account-out-390`。

320 同城英雄按钮不再被裁切。390 未登录恢复按钮在滚到底后位于固定操作条之上。静态预览顶部的 9:41 是预览工具装饰。

## 测试

- 版面修复前：上述七个相关测试文件 136 通过 / 0 失败。
- 恢复入口断言和版面修复之后，用绝对路径重跑上述两个导航测试：10 通过 / 0 失败。断言包含 `account-guest-links`，该字符串只存在于本工作区。
- 标题断言从旧的 `scb-header`“赛事/球队”改为“小城市篮球”。公开招募、观赛链接、球队事务、加入码、建队、球场插画和未登录恢复入口的断言仍在。没有删除测试或放宽原功能断言。

## 与效果图的有意差异

- 目录阶段只有进行中、即将开始、历史赛事。
- 赛事卡“公开招募”进入现有公开招募页。
- 同城一次只查询当前供给类型。
- 英雄图和卡片复用首页 `event-court.jpg`、`hero.jpg`、`service-court.png`、`service-referee.png`、`brandmark.svg`。奖杯主视觉、等距插画和鲸鱼队徽没有正式素材，这些是替代，不是精准还原。
- 城市、人名、金额和日期没有写进页面常量。
- 球队加号进入现有申请建队，不绕过创建权限。
- 未登录“我的”仍隐藏五栏导航。

## 未验证与阻塞

- 真实目录、同城供给、球队列表：微信请求失败，错误文案是网络中断。没有改域名，没有关 `urlCheck`，没有伪造成功。
- 已登录我的、有数据的赛事卡、供给详情、预约回执、多球队、长名称、图片失败、键盘遮挡：未执行。
- 从四页点进其他页再返回：未执行。
- 真机：未执行。
- 首页文件不在本工作区差异里。

## 2026-11-02 请求根因与无登录点击

系统请求（校验证书，未关校验）打到 `106.55.24.179`：

- `GET /health` HTTP 200，`X-Request-Id: 06ad990f-5dc3-4299-be8d-b3e48dfdd9bf`
- `GET /ready` HTTP 200，`X-Request-Id: 5e4b1dd7-93b2-417a-bcdc-305c4d80f672`
- `GET /v1/public/regions`、`GET /v1/public/directory?status=LIVE&limit=1`、`GET /v1/public/local-listings?limit=20` 都是 HTTP 404，`RESOURCE_NOT_FOUND`。这三条路径在本仓库 API 源码里存在。

微信开发者工具里对同一批 URL 的 `wx.request` 原始失败都是 `request:fail url not in domain list`，没有 HTTP 状态码，也没有服务端请求标识。`utils/api.js` 的 `fail()` 丢掉 `errMsg`，页面才显示“网络连接中断”。这是合法域名拦截，加上错误被收成同一句。不是 401/403，不是本机 DNS/TLS 失败。`urlCheck` 仍为 true，没有改。

赛事顶栏搜索在模拟器里被挤成不可见。已在 `components/v3-chrome` 给搜索条固定最小宽度并隔离组件样式。修复后的模拟器截图能看到“搜赛事、球...”。

自动化点到了页面自己的按钮：阶段切到即将开始、历史赛事、进行中；同城人员服务再切回球场，筛选面板打开；申请建队、加入码、登录拦截、忘记密码都能进入再返回。底栏“我的”由桌面点击进入未登录账号页。顶栏城市、搜索、消息的自定义组件内部按钮，自动化选不中；桌面点击城市没有离开同城页。

## 2026-11-02 账号页微信登录优先

工作区仍是 `D:\Projects\small-city-basketball-v3-nav`，分支 `ui/v3-main-nav`，HEAD `b1e6c9f2c27cd60563fde24fbf62d239bb003c9e`。首页工作区仍是 `fix/wechat-homepage`，同一 HEAD，未跟踪目录未动。微信工程指向 `apps/wechat`。`project.config.json` 仍是 `touristappid`、`urlCheck` true、`miniprogramRoot` `./`。

本地没有找到用户提到的双屏效果图文件。页面按本轮文字要求实现，主视觉用现有 `assets/home/event-court.jpg`，不是新插画，也不把整张效果图铺上去。

未登录首屏是品牌头、标题“我的”、设置、深蓝场地卡、白色登录卡、微信主按钮、协议与隐私、邮箱登录、找回账号、帮助与客服、隐私与账号，以及本页始终显示的五导航。邮箱表单默认收起。已登录首屏用真实 `displayName` 和统一默认头像，四格入口、浅橙角色工作台、五个分组和底部品牌卡。更多服务、绑定、切换、退出、注销仍在二级区域。

原功能对应：

- 微信登录：首屏主按钮。只在能力为已开放且本次勾选同意后走原 challenge、`wx.login`、会话核验。阅读协议不写入同意。
- 能力核对中：按钮不可执行。明确未开放：按钮保留但不可执行，邮箱入口仍在。读取失败：文案“暂时无法核对微信登录状态”，重试调用原 `load()`，不显示“暂未开放”。
- 邮箱登录、注册、找回、验证邮箱：邮箱面板。空账号或空密码就地提示并返回，密码不 trim。`returnTo` 仍由 `safeReturn` 保存。
- 我的报名、完善个人资料：`participant-materials`。我的球队：`teams`。我的预约：原订单二级选择。我的关注：`follows`。
- 主办方、记分、媒体：原三个工作台按钮，没有角色时保持不可执行。机构管理仍在“角色与机构配置”。
- 帮助与客服：`governance`。隐私与账号：游客打开页内说明；已登录进入原绑定、找回和注销。
- 切换账号、退出、注销、其余菜单：保留在“更多服务与设置”和账号安全页。

验证：

- `c10-account` 与 `ui002-nav` 13 项通过。空登录不发请求、密码空格原样提交、能力拒绝保持 unknown、明确关闭才显示“暂未开放”，都在测试里。
- 静态预览 320/390/430 横向溢出为 0，可见按钮高度都不低于 44。滚到底时品牌卡与底栏有空隙。截图在 `D:\Projects\scb-ui-review\v3-nav\2026-11-02-1605\`。
- 微信开发者工具实际打开本工作区。游客页是新布局，五导航可见。邮箱面板可打开并返回。空表单提示“请填写账号和密码”，没有出现“网络连接中断”。找回账号进入 `pages/account-recovery/index`。`returnTo=/pages/watch/index` 后 `hasReturn` 仍为 true，邮箱按钮变为“登录并返回刚才的操作”。能力请求失败，状态是 unknown，重试后仍是 unknown。这不是已关闭，也不是登录成功。
- 已登录界面只用合成数据做静态预览，不能计作真实登录。键盘遮挡未在模拟器弹出键盘，只保留 `cursor-spacing="160"`。明确未开放的界面没有从线上拿到 `enabled: false`，该状态由测试和静态预览覆盖。

素材缺项：没有单独的设置齿轮和微信图标，两处用文字按钮。场地卡是首页场地照片，不是效果图里的独立插画。

commit、push、pack、部署、Migration、生产写入：未执行。

## Git

未执行 commit、push、pack、部署、Migration 或生产数据修改。下一位先在 `ui/v3-main-nav` 核验未提交文件，不要把改动混回 `fix/wechat-homepage`。下一步唯一优先事项仍是把 `basketball.playhubs.cn` 配进微信合法域名；配好之前真实微信登录到不了服务端会话核验。

## 2026-11-02 账号页 Figma V4 双态

工作区 `D:\Projects\small-city-basketball-v3-nav`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `ui/v3-main-nav`，HEAD `b1e6c9f2c27cd60563fde24fbf62d239bb003c9e`。没有切换分支。微信工程是 `D:\Projects\small-city-basketball-v3-nav\apps\wechat`。Figma 文件 `QpKOskViUwHFVqSG3uYR9X` 已读到未登录 `15:625`、微信开放 `15:738`、已登录 `10:453`，以及能力未知 `15:1226`、登录中 `15:1155`、未绑定 `15:1342`、登录失败 `15:1455`。设计包 `D:\Projects\small-city-basketball\docs\design\ui-v4` 只读。状态仍是 IN_PROGRESS / LOCAL_ONLY，本批不做 DONE。

本轮只改账号页和它的测试、夹具。`components/v3-chrome`、`visual.wxss`、`app.wxss`、赛事、同城、球队都没有再改。320 宽四格被共享样式收成两列，已在账号页自己的样式里用同等选择器改回四列，不影响其他主导航页。因此没有跑 `npm run test:wechat`。

可见结果：

- 未登录：深蓝标题、白底、橙色业务按钮、微信开放时绿色主按钮。邮箱登录、找回账号、用户协议、隐私说明保留。游客显示首页、赛事、同城、球队、我的。
- 微信状态分开：未开放是浅色“微信登录暂未开放”；能力读失败是浅色“微信快捷登录”加“暂时无法核对微信登录状态 / 不代表服务已关闭”；登录中是绿色禁用“正在登录…”；未绑定和登录失败各自有说明，失败才出现“重新核对登录状态”。阅读协议不写入认证同意。同意框默认不勾，勾选后才发送 `consent: true`。未绑定保持未登录，不自动注册，不伪造成功。
- 已登录：真实 `displayName`，空则“未填写显示名称”。我的报名、我的球队、我的预约、我的关注在首屏。没有角色时不显示角色工作台；有角色时用真实角色摘要，展开后仍是原来的赛事工作台、记分与赛果复核、直播与媒体。原有二级入口留在“更多服务与设置”。没有把“合成球友甲”或“合成示例”写进页面。

验证：

- `node --test apps/wechat/test/c10-account.test.cjs apps/wechat/test/account-platform.test.cjs apps/wechat/test/ui002-main-navigation.test.cjs apps/wechat/test/ui002-nav.test.cjs apps/wechat/test/native-structure.test.cjs`：111 通过 / 0 失败。去掉重复提示后重跑，结果相同。
- `git diff --check` 无空白错误。
- 静态预览来自本工作区 `apps/wechat` 的 `native-preview`，由 Cursor 浏览器打开，不是微信运行时。320、390、430 横向溢出为 0。长名称在 320 换行。滚到底后品牌卡与底栏之间约 40px。页底留白计算为 `104px + env(safe-area-inset-bottom)`，这次 Chromium 里安全区为 0，计算值是 104px。按钮高度四舍五入后不低于 44。截图在 `D:\Projects\scb-ui-review\v4-account\2026-11-02\`。
- 9420 端口当时在监听。本轮没有连接开发者工具，没有重新编译，没有模拟器截图，没有关 `urlCheck`。真机未执行。键盘遮挡未在模拟器弹出键盘。

素材仍用现有 `profile-active.svg` 和文字“设置”，没有新增球衣、微信或齿轮图片。commit、push、pack、部署、Migration、生产写入均未执行。本批停止，等待验收，不继续其余页面。
