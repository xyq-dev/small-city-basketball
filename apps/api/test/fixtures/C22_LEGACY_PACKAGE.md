# C22 旧恢复包证据

`c22-legacy-package.json` 固定来自公开仓库 C20 main 提交 `406568891a8eb95219b962cbdcb7fa422b257f46` 的八个恢复相关源码文件及 22 个原 Migration 的 SHA-256；没有账号、凭据或备份数据。

测试在私有临时目录还原该包，核对每个源码和原迁移哈希，再对测试专属 78 表库真实 backup／restore／quarantine，随后执行新迁移并验证旧数据保留与新 runtime readiness。新恢复包必须拒绝旧归档，不能通过放宽表数冒充兼容。该测试不支持生产运行：入口要求 loopback、scb_test_* 控制库、临时角色和独立数据库归属核验。

CI 的 `prepare-ci-postgres-clients.mjs` 已提供 PostgreSQL 18.6 archive clients、工作目录和 NOLOGIN scb_migrator；该用例仅在这个隔离服务里临时启用其登录，完成后恢复 NOLOGIN／NULL password，并删除自己创建的三个角色和带归属标记的库。其他已存在的服务角色会使测试拒绝执行。
