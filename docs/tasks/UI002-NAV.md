# UI002-NAV · 我的与同城主导航结构

状态：REVIEW / LOCAL_ONLY。负责人：Codex /root/ui_services，集成人：/root。

开工核验：2026-11-01 UTC，独立目录`/workspace/scratch/5a4363d2d0b7/scb-ui-nav`、分支`work/ui002-nav`，基线`1413d53ed0b7ddb632a4f4db428b0ef338800273`，远端`https://github.com/xyq-dev/small-city-basketball.git`，初始干净；T07 worktree保持干净。已读根AGENTS、CURRENT_STATUS、TASKS、COLLABORATION和UI001依据。

root分配独占account/local WXML、WXSS及必要纯显示JS、新直接测试及本任务/交接。不可修改API、mutation、收费、权限、读写代次、pending或角色。watch/teams/sharedheader由root负责，旧共享测试/fixtures由validation负责；资产由root供应，依赖3d36499本地cherry为98d5d8e，本实现不重复该依赖。

已亲看A01(4:378)、L01(4:206)原图和metadata，取得4:400四重点、4:434三工作台、4:226品牌130、4:243供给示意card、4:234类型tabs、4:399身份说明高保真context与截图；4:219顶部tabs采用mapping已实际取得的本地context和截图。4:391和4:392请求未返回后终止，不重复请求；身份64Avatar/24名/12元信息复用已取得T07相同Profile视觉结构，对照A01实际metadata和整页截图。

实施计划：A01身份→本人四重点→当前角色三个资源入口，长功能菜单收于明确更多区，全部既有服务仍可达。直播媒体先选有权赛事比赛，不造无参数任务总表。L01选城/附近/我的预约→130品牌→四服务tab→真实已审核供给与档期，定位/高级类型/查询与扩展服务置显式展开区；默认COURT仅UI只读筛选，ALL仍可用，原地图viewport、UNKNOWN和收费门槛保持。

验证计划：直接Page/真实utils验证主导航、busy/权限显示、无新增写入、pending恢复与地图原查询；320/390/430原模板输出。最终三宽浏览器/CI由root精确候选执行；微信真机、正式支付保险直播及生产均不在本子任务执行范围。


本片结构已实施：A01身份卡（64背景内原28用户SVG、24/34显示名、12/18账号事实、14/22说明），默认“我的篮球”四个重点及当前角色三入口；订单明确展开本人资金、球场、球员发出/收到预约，原长菜单置“更多服务与设置”，机构配置仍沿原workspace及managedOrgs过滤。三工作入口仅当前roles存在时可点；赛事与直播媒体先选当前有权赛事比赛，记分沿原scoring-tasks；不假造无资源参数的任务总表、不把入口视为授权。账号/隐私与客服进入原security，保留原绑定/解绑/注销/账号找回并补客服原路由。加载、未登录、注册关闭、绑定和失败状态未删除。

L01默认顺序已改为选城/附近/我的预约44tabs、130品牌区、四服务44tabs和真实已审核供给。Court默认COURT是root确认的只读UI选择，人员tab采用原REFEREE筛选并显示原人员子类型，ALL保留在显式展开高级筛选；球员邀约走原players、球队约赛走原matchups。所有原query/location/place/地图viewport/cross-city/map-error/旧列表/paging节点和收费、锁位、pending/UNKNOWN、回执恢复、详情/档期/地点同意控件仍在；位置、搜索、经营、撮合/派单/培训入口置结果后明确展开区，未自动请求定位。Court使用原Figma326×132矢量示意（明确非实拍），展示实际title/address/org/距离/资质，并通过原detail进入真实档期；不填图中示例场馆或价格。

依赖：root原始资产3d36499→本地98d5d8e（court/chevron/brand副本），原68球直接复用已存在node-4-43-0.svg；root header与六菜单原SVG da6e076→本地e27a4eb。源码只引用这些已落盘Figma资产，无临时URL或私有头像。account/local均main=true、back=false，实际title分别“我的”“同城”；sharedheader由root维护，本提交不重复依赖。

直接验证`node --test apps/wechat/test/ui002-nav.test.cjs apps/wechat/test/x12-local-services.test.cjs`32/32通过（新5＋原27），涵盖320/390/430真实模板、四重点/三工作台闭态、原org作用域、面板busy及换号清理、默认Court/人员/ALL只读搜索、无自动定位、pending/viewport/read-only导航、所有WXML handlers及安全登录分支。基线VM函数源码比较确认local全部既有方法逐字相同，仅新增players导航；account全部业务函数逐字相同，只有onShow会话回调额外清两个display布尔值，并新增两个纯显示开关。原API、roles解析、mutation、收费、序列和持久pending函数均未改。两JS/自有CJS定向Prettier与git diff --check通过。

历史布局suite实跑48项中45通过、3失败，全部已定位并交validation迁移：account-platform原默认全长菜单、c10-account旧主场hero/球队菜单前置，以及旧22fixture禁止账号头像/菜单SVG的资产假设。它们与本轮最新A01结构冲突，不能作为全部验证通过；共享断言和fixture均由validation独占修改，并要求保持全部原路由/机构scope/安全断言，在实际展开状态复验。没有直接放宽测试、删除失败或改伪样本。

本地浏览器几何、截图及全候选CI未执行；交root精确最终候选和validation独占的几何守卫。独立audit已收到只读delta、待最终整合审查；任务保持REVIEW而非DONE。微信真机/正式支付保险直播未执行，未写/执行Migration、未pack/部署/生产修改。实现提交交root串行cherry-pick并同步，不重复两个依赖SHA；本子任务不push。

检查点：2026-11-01T08:37:00+00:00。当前工作区仅己域实现/自有测试/任务交接待提交，下一步root整合该实现与validation对齐测试，再用精确新候选CI检查三宽。
