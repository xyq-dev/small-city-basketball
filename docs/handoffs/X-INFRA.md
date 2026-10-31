# X-INFRA交接

root批准infra独占见docs/tasks/X-INFRA.md。先接本片manifest127表/105应用函数（12helper runtime EXECUTE）；依赖完整025–035，尤其032公共档案4表与x08_public_archive_guard签名，不能在缺032时运行迁移/生产readiness后误判通过。所有当前新增表/列权限已按各owner逐一核对，不为SELECT行锁扩大immutable UPDATE；X05已另用80f2fc2去不必要锁，X03另修026。

本片函数ACL适用于全部non-extension public应用函数，精确登记trigger+helper身份；btree_gist扩展函数保持其所需权限，禁止SECURITY DEFINER；普通runtime仅12非trigger helper执行，backup不执行应用函数，PUBLIC不执行。readiness核对权限；原table列权限核对保持。

迁移计划保留既有事务/checksum合同，加连续唯一规范序号与已应用前缀检查。9单测与API tsconfig已通过；PG/grants/restore均尚未执行。后续片继续更换hardcoded24/83、隔离所有新公开授权/找回邮件任务与token、保留私密历史且不输出，真实运行交根CI。

I2去除所有本组backup/restore/fingerprint/production/restart旧24/83硬编码。镜像逐SQL文件名/checksum对源；restore新建前exact表名集合，返回真实表数。私密工单附件bytea与邮件envelope在PG内摘要，报告只长度/摘要与元数据。15个本地单测通过；脚本语法/格式与API tsconfig通过；无PG/dump/restore实际结果。root需另改旧c02/c22固定83测试（已告知）。
