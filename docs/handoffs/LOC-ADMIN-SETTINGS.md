# 定位与地图设置交接

2026-11-10T08:05+08:00。负责人在独立工作树完成本地实现，未提交。

- 目录：`D:\Projects\scb-worktrees\admin-location-settings`
- 分支：`feat/admin-location-settings`
- HEAD：`e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`
- 原目录 `fix/home-page-ui` 的未提交首页修复和 47 份归档保持原状。

高德是草稿里的默认选项。没有后台有效配置时仍使用腾讯环境变量。保存草稿不切换线上服务。启用后每次请求只读一个配置版本。显式停用后环境变量不能重新打开外部地图。地图结果只是地点参考。

`053_platform_location_settings.sql` 已编写，隔离库未执行，生产未执行。加密用途是 `SCB_LOCATION_CONFIG_KEY`，不复用对象存储密钥或表。052 是已合并的会员迁移，定位不再占用这个编号。

缺少真实 Key 不阻止隔离测试，但本机没有可用的测试数据库，所以迁移和 HTTP 权限还没有实际跑过。真实高德联调和微信真机未做。提交前需要 Codex 复审。
