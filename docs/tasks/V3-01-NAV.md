# V3-01-NAV 四个主导航页面视觉

- 状态：IN_PROGRESS
- 整合：LOCAL_ONLY
- 负责人：当前 Cursor 会话
- 更新：2026-11-02 Asia/Shanghai，账号页按 Figma V4 双态改完，等待验收
- 基线：`fix/wechat-homepage` `b1e6c9f2c27cd60563fde24fbf62d239bb003c9e`
- 分支：`ui/v3-main-nav`（本轮重新核验，HEAD 仍是上述基线，改动未提交）
- 目录：`D:\Projects\small-city-basketball-v3-nav`
- 允许路径：`pages/watch`、`pages/local`、`pages/teams`、`pages/account` 的视觉与页内事件，新组件 `components/v3-chrome`，本任务卡与交接。四页 JSON 只登记本组件。导航测试只补了被换掉的标题和未登录恢复入口断言。
- 权限：允许本地检查、必要测试和临时预览。未授权 commit、push、pack、部署、Migration、生产数据或付费资源。本轮均未执行。

## 范围

按 `scb_remaining_ui_v3/boards/01.png` 的 V3-01-1 至 V3-01-4 检查赛事、同城、球队、我的。切城和搜索页面不改。`docs/design/REMAINING_PAGES_VISUAL_V3.md` 不在本工作区和首页分支，存在于 `origin/main` 提交 `02c4fcf`，已用 `git show` 阅读，没有合并。

## 验收结论

四页仍是部分通过，不能写成微信验收通过，也不进入下一批。

账号页本轮按 Figma V4 未登录、微信开放和已登录三张主画面，以及能力未知、登录中、未绑定、登录失败四张状态落地。游客仍看到五导航。已登录首屏绑定真实显示名，没有角色时不显示工作台。二级服务仍留在“更多服务与设置”。只支持已绑定应用账号登录，不自动注册。真实微信登录仍被合法域名拦住。静态预览不是开发者工具或真机。详见 `docs/handoffs/V3-01-NAV.md`。本批到此停止，不继续其余页面。
