# P07-A PG / 恢复交接

状态：REVIEW / LOCAL_ONLY。2026-10-23（Asia/Shanghai）由 `/root/resume_recovery` 接续原 `/root/p01_browser_tests` 工作，实际目录 `/workspace/scratch/93747c9ad2cb/p07-db`，分支 `feat/P07-recovery`。从远端 main `f2bf36585f09a0e55df41328a1d25f33e479e012`、tree `80a9b297e780840914ab5f27c6c8cccd9fa3a45d` 核验开工；接续基线 `d942b63a794585418647efc25525c8173c683e2e`，原 ops、P07 quarantine/support 与本交接未跟踪，均完整保留后继续。已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION 与 P07-A 全卡。

已独立提交权限 manifest `d942b63a794585418647efc25525c8173c683e2e`，固定 39 表、列级 UPDATE，audit_logs 仅 INSERT、schema_migrations 仅 SELECT；不授未来表或 sequence。root/API 已收到接口。

当前检查点：角色 provision、compiled migrate→grant、私有文件/passfile、恢复 ownership proof、完整 custom backup/restore、39表与schema/checksum fingerprint、quarantine 均已实现。quarantine 和 4 项 PG 测试为原工作成果；接续新增 10 项 `p07-runtime.integration.test.ts`，覆盖真实 PostgreSQL 双初始化行锁等待、首owner唯一成功、既有个人账号不提升/密码不替换、审计拒绝全回滚、runtime/backup最小权限、缺失/过宽ACL及重新应用、角色高权或migrator成员关系、migration缺失/extra/checksum漂移、readiness固定503及缺btree_gist。运行阶段须由CI实际执行，不把发现用例写成通过。

所有 PG Pool 连接设5秒超时，provision连接失败也关闭Pool。001–006与39表权限manifest未改变，无新业务Migration。

接口：各 job 主 DSN 为 DATABASE_URL(_FILE)，严格二选一；provision 另读 DATABASE_MIGRATOR_URL、DATABASE_RUNTIME_URL、DATABASE_BACKUP_URL 各自 FILE 或 inline。backup 读 ARCHIVE_PATH，自动伴随 `${ARCHIVE_PATH}.manifest.json`，两者 0600／父目录0700。restore 使用目标 admin/control DSN 与目标 migrator/control DSN，RESTORE_DATABASE_NAME 必须全新 scb_restore_*，RESTORE_RECEIPT_PATH 新建0600，OID+随机 nonce 数据库 COMMENT 证明自有目标。quarantine 通过相同 receipt 复核，只用 migrator 身份维护，不修改 overlay_sessions，不删除已有库。

P07 PG 使用独立 provisioned 集群及 TEST_P07_{ADMIN,MIGRATOR,RUNTIME,BACKUP}_DATABASE_URL_FILE，control DB 仅 scb_test_production_*，每 fixture 新建自有 scb_restore_UUID；不依赖/不清理旧123场景数据库。测试库初始化可调用 migrate；生产 restore 不先 migrate，必须完整 pg_restore。

本地已执行：所有8个 `.mjs` 的 `node --check`、API完整strict类型检查（包含本卡PG测试）、独占ops/P07测试Prettier、`git diff --check`；均通过。`vitest list test/p07` 实际发现14项，执行0项。另20项私有路径/权限、独占输出、防符号链接/覆盖、错误secret来源、不安全DSN/目标名/receipt的guard探针通过，明确没有打开数据库连接。

为类型及发现验证，按root授权先整合API冻结 `5df73bb` →本分支 `771a1fc`，再整合API实现 `2cad137` →本分支 `a64611c`；这两提交为测试依赖，root已集成同源实现，最终只挑选本交接对应的PG提交，不重复挑上述API提交。最初直接挑实现提交遇到缺冻结前置的modify/delete冲突，已仅撤销该次未完成cherry-pick，再按前置顺序重放；没有丢失原PG文件。

本地尚未运行 PostgreSQL、Docker、dump/restore 或 PG 场景；本环境 UID0，不绕过保护。真实 PG18.6、第二新实例/卷、TLS/镜像/完整业务链、阶段一39表指纹及阶段二凭据隔离均由 root CI 验收。当前任何本地静态检查不代表真库通过。未 push、未执行生产Migration或部署。下一步root整合本分支PG交付提交并做独立审查后，使用 `vitest run test/p07` 在独立provisioned集群执行14项；保留源/control，仅清理各fixture nonce+OID+数据库comment证实为自身创建的目标。

## 首次真实CI后的共享目录修复

root报告首CI `39822056375` 的production P07场景8通过、6失败；错误集中在ownership校验及fixture清理。数据库COMMENT存于共享目录 `pg_shdescription`，原三个查询误用每库 `obj_description`。已将 `ops/db/common.mjs` 两处及 `p07-support.ts` 清理门一处改为 `shobj_description`，保留数据库名、精确OID、随机nonce三重一致性，不放宽目标所有权条件。

原ownership PG用例增加从控制库、目标库分别直接联接 `pg_database`／`pg_shdescription` 验证相同comment，并验证正式 `assertOwnedRestoreTarget` 对合法目标成功、对错误名称/OID/nonce仍失败。总数保持14项；本地仅类型、语法、格式、发现与diff检查通过，修复后的真实PG／dump恢复尚待下一轮CI，不能因根因明确而宣称已通过。

## 第二次真实CI后的连接排空修复

root报告第二CI `39822735630` 的14项P07用例全部成功，但Vitest捕获一条未处理 `57P01 terminating connection due to administrator command`，production job仍失败。核对实际安装的 `pg-pool/index.js`：`_remove` 先将idle client从 `_clients` 删除，再调用异步 `client.end(callback)`；`_pulseQueue` 见 `_clients` 为空即触发Pool结束回调，不能据此认为服务端连接已退出。原fixture随后 `DROP DATABASE ... WITH (FORCE)` 可能终止仍在关闭中的socket。

测试helper现在在Pool结束后，经control连接有界轮询精确自有数据库的 `pg_stat_activity` client backend归零，再重新核对OID/nonce并执行普通DROP；5秒内未归零明确失败，不终止任何连接、不吞全局错误。新增两项真实PG回归：明确持有独立client，观察helper等待且该client仍可查询，再正常关闭client并完成清理；以及故意持续持有client超过排空期限，验证清理拒绝、client仍可查询、control保留，之后仅在原OID/nonce匹配且backend归零时普通DROP自己的负向fixture。成功清理还从独立control连接断言目标库已删除、control仍可查询。P07总计16项；本地类型、格式、diff及用例发现通过，下一CI才可确认实际资源释放与完整恢复结果。
