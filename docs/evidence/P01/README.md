# P01 验收与整合证据

日期：2026-10-22（Asia/Shanghai）。当前状态 **DONE / MAIN**；历史本地检查与正式远端检查分别记录。

## 正式交付与远端CI

- 代码提交：`819818d2f9fcee972f4c2e7854800dc6ad2415bf`；分支 `feat/P01-organizer-console` 已推送。
- [PR #1](https://github.com/xyq-dev/small-city-basketball/pull/1) 已合并，main整合提交 `f15adb456c24302ce3d41587c41301e4c3931c6c`，可克隆安装并运行。
- [Application checks run 39728632742](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742) / [job 119658281781](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742/job/119658281781)：success。
- 远端实际完成 `npm ci`、`format:check`、`typecheck`、35项单测/组件测试、生产构建、官方Playwright Chromium下载及12项桌面/手机模拟E2E。
- 这是P01前端原型验收，不是P02后端、生产部署、Safari/微信真机或真实认证/数据库/OBS验收。

## 历史本地快照与指纹

早期本地检查基于 `daea629079bfabc5e77407ae58b50b4af01c1e20` 上的未提交工作区。其 REVIEW / LOCAL_ONLY 状态已被正式提交与整合替代。

[source-manifest.json](source-manifest.json) 原样保留该历史P01工作区的22个源文件/配置/锁文件SHA-256。总指纹由按路径排序的 `<文件SHA-256>  <相对路径>\n` 内容计算。它不是main当前文件清单，也不是P02指纹，不随后续源码改动重算；源码恢复以Git正式提交为准。

历史本地安装、格式、类型、35项测试和构建通过。默认Chromium151曾下载失败，随后用仓库外QA Chromium153.0.8010.0完成12项E2E；官方远端路径后来已验证通过，不能继续把该本地下载失败写成当前CI阻断。

额外视觉检查覆盖四页各1440、1024、390宽度，共12视图：无横向溢出或运行错误，主要按钮不低于44px。选定截图保留如下。完整命令和接续步骤见[交接记录](../../handoffs/P01.md)和[开发说明](../../DEVELOPMENT.md)。

## 历史应用实拍

以下是运行中的本地P01原型，不是概念图；使用合成资料和刷新重置的内存数据。QA截图时临时注入本地中文字库以补齐容器缺字，产品仍采用系统字体；不代表所有操作系统字体环境均已验证。

桌面工作总览，1440px：

![P01机构后台桌面实拍](dashboard-desktop.png)

手机创建赛事，390px：

![P01创建赛事手机实拍](create-mobile.png)
