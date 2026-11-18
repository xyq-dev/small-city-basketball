# 后台定位与地图设置

## 2026-11-10T08:05+08:00 本地实现（未提交，未验收）

工作树 `D:\Projects\scb-worktrees\admin-location-settings`，分支 `feat/admin-location-settings`，基线 `e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`（核验后的 `origin/main`）。原目录 `D:\Projects\small-city-basketball` 的 `fix/home-page-ui` 未提交改动和归档未改。

范围：平台管理员的「系统设置 → 定位与地图」（`/system/location`）、高德适配器、配置版本和加密草稿。没有确认的 Figma 节点，页面只按对象存储页的现有样式实现，隔离预览不能当作设计验收。

Migration `052_platform_location_settings.sql`：已编写。隔离库未执行，因为本机没有 PostgreSQL，且 `TEST_DATABASE_URL` 未设置。生产未执行。001—051 未改。

未 commit、push、merge、pack 或部署。没有真实高德 Key，没有云端联调，没有微信真机。涉及密钥和数据库变更，提交前交 Codex 复审。

## 交接

下一位先在本工作树核对分支和未提交文件，不要回到原目录改这些文件。有隔离 PostgreSQL 后，用库名 `scb_test_*` 跑 `apps/api/test/location-settings.integration.test.ts`，并补 C19 升级里 052 的空配置断言。真实 Key、高德控制台白名单和微信真机仍是联调待办。

2026-11-18 接到 `e595ba9`：会员迁移已经占用 052，定位迁移改为 `053_platform_location_settings.sql`，函数前缀改为 `c53_location_`。文件已编写，本轮没有执行。账号页的按届办赛规则保持不动。
