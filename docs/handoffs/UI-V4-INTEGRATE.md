# UI V4 四页整合交接

- 时间：2026-11-03 Asia/Shanghai
- 日常目录：`D:\Projects\small-city-basketball`
- 候选分支：`integrate/ui-v4-consolidate`
- 基线：`ef25846857bb0431a4f71ad8dbe6fac87f945ae0`（当时 `origin/main`，含 #38 与 #39）
- 微信工程目标：`D:\Projects\small-city-basketball\apps\wechat`

## 已整合

- 账号页未登录微信优先、邮箱二级面板、能力未知/未开放/未绑定/失败提示，以及已登录四格、角色工作台和原有更多服务。
- 赛事、同城、球队页面及 `apps/wechat/components/v3-chrome`。
- 直接相关的小程序测试和夹具。账号页素材断言保留 main 上“不要把首页素材包其余文件带进账号夹具”的检查，只放行页头实际使用的 `brandmark.svg`。
- `docs/design/ui-v4` 的交接、提示词、路由索引、清单和 review 文字。

## 不纳入

- `fix/ui002-ci`：`fc8c2eb` 已是 main 祖先。
- `docs/design/ui-v4/REFERENCE_V3`、`scb-homepage-assets-v1`、`scb_remaining_ui_v3`：参考截图和未由页面引用的素材包，留在本机备份，不进小程序包。
- 首页 `pages/home`：main 已有 #39，本轮没有覆盖。`project.config.json` 的本机 AppID 不提交。

## 验证

2026-11-03 本机 `npm run test:wechat`：1197 项里 1196 通过，1 项失败。失败是 `native-components` 创建符号链接时的 Windows `EPERM`，测试没有改、也没有跳过。该项交给 Linux CI 核对。`git diff --check` 通过。没有 pack、上传、部署或生产 Migration。
