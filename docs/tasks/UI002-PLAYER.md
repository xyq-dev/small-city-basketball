# UI002-PLAYER · T07球员详情落实

状态：REVIEW / LOCAL_ONLY。负责人：Codex /root/ui_services；集成人：/root。

2026-11-01 UTC核验：目录`/workspace/scratch/5a4363d2d0b7/scb-ui-player`，远端`https://github.com/xyq-dev/small-city-basketball.git`，独立分支`work/ui002-player`，基线`3316083e47cab2adf8a16cca05534e87a83981f0`（root tree2c7）。新worktree初始干净，没有接管旧services分支。已读取根AGENTS、docs/CURRENT_STATUS、TASKS、COLLABORATION、UI001_SCREEN_INDEX和WECHAT_UI_V2。

root明确本轮最新UI001覆盖旧C11：允许仅player/index.wxml及index.wxss重组视图，保持JS、API、费用、权限与所有handlers；自有新直接测试及本任务/交接。共享native/E2E与catalog由validation独占，头像asset由root提供，未取得其他路径写入权。commit本地后交root串行整合，未授权子任务push/部署/Migration/生产操作。

已按figma-design-to-code读取5:1102 metadata，以及5:1115身份、5:1124概览、5:1132可约、5:1135费用、5:1139双CTA的高保真context与截图。实施目标白header84、16页边、r16普通card、64头像、真实分项费用、双48操作。实际记录与未知/未统计支路保留；默认对比按钮直接可见。静态默认头像引用root供应的Figma用户SVG，不新增公开私有照片。

计划验证：真实Page/真实utils的金额派生与session保护、toggle/book/records/information既有handler；320/390/430真实模板输出及正常/未统计/错误/未登录状态。浏览器几何和截图由root最终候选CI171检验，微信真机未授权或具备环境时如实列未执行。


本片实施完成：仅`apps/wechat/pages/player/index.wxml`、`index.wxss`、自有`apps/wechat/test/ui002-player.test.cjs`与本任务/交接。默认白scb-header，移除大hero/72%照片和全宽大金额报价；16页边的身份卡为64avatar、24/34姓名、12/18资料、14/22真实服务价，标准126且长名自适应。默认概览是授权统计样本与完成服务记录两项真实事实（标准86），可约标题28和双行body44组合为标准112；真实多个窗口可增长。费用普通r16/p16卡显示实际服务、平台、交通、食宿及含费合计，保留auto内在宽、wrap及数字nowrap避免大额错断和两列重叠；费用比设计示例增加真实分项时纵向增长，不硬截示例金额。默认底部直接toggle加入/移出同价对比和book发起预约，两48高按钮，390稿各173、gap12、左右16、上12/底28加安全区；recordsOpen次按钮仍返回详情。

已授权头像仅使用已有profile.portrait动态64裁切；真实utils仍过滤未经许可上游portrait，JS完全未改。默认资产直接复用root取自5:1115的Icon/user SVG，28×28，sha256`64fae45f090a3fa44ad06479bd0bc7a6731c47ca09bb5ef04fb9afc3b211810d`，在64soft背景内按28展示。root资产/重开文档依赖bcdf68e在本地cherry为a9be244，本实现提交不重复带入该依赖。新模板没有引用临时Figma URL、示例照片或私有照片。

原JS源码哈希`761bb0dbc26e9504c38bce8193b98025a61f8e2c`保持，所有displayToken、visible、ui.live、session、APPROVED/404、资金与金额派生、market/toggle/compare/book/login/load及recordsToggle/informationToggle均不修改。记录来源、统计截至、独立确认、最多5条、有限样本、未知/读取失败/0与未统计分别展示；详细统计和进入对比继续可达。

实际验证：`node --test apps/wechat/test/ui002-player.test.cjs apps/wechat/test/c10-profiles.test.cjs apps/wechat/test/player-market.test.cjs apps/wechat/test/ui002-services.test.cjs`64/64通过（含新5项）。新直接测试基于真实Page/session/utils，验证默认结构与两操作、toggle/book接线和隐藏后的displayToken门槛、展开/记录返回、三个统计状态、真实派生小数/上限金额、加载/登录/错误恢复；320/390/430模板均输出，默认头像非空并在实际slot引用。自有CJS定向Prettier和git diff --check通过。浏览器像素/几何/Range及金额矩形不重叠由validation独占共享测试迁移并交root最终新候选CI171核验；旧C11结构相关历史断言不因旧CI170通过而视为当前UI001完成。微信真机、正式支付、保险、直播均未执行。

独立审查：已交/root/ui_audit只读delta，待root最终整合/审查与精确候选CI，未标DONE。Git本地实现提交交root串行cherry-pick并同步；本子任务没有push、pack、部署、Migration或生产操作。下一步：root仅取本实现SHA（不重复a9be244依赖），合并validation的UI001断言与旧C10/C11映射，再跑新候选CI171并检查三宽截图。

检查点：2026-11-01T08:16:52+00:00；64项直接验证已完成，当前工作区仅己域待提交文件，等待root整合及精确新候选CI。
