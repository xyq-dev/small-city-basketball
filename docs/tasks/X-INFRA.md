# X-INFRA 025–035运行权限与恢复门槛

2026-10-31；root交completion_recruitment负责。仅本地切片commit，root串行cherry并同步GitHub。

状态IN_PROGRESS。root批准文件所有权：runtime-privileges.json、readiness及测试、database/migrate及migration-plan；ops/db/privileges；ops/recovery backup/restore/fingerprint/quarantine及types；production/restart脚本；P07 runtime/quarantine测试及独立completion fixtures。禁止业务app/service/ui和旧迁移001–024。

已核对owner清单：025第三名无新表；026模板4表；027招募/邀请/海报6表；028技术统计仅scoring_states/result_confirmations新增技术字段；029同城7表；030治理/广告/经费12表；031邮箱找回5表与users验证/凭据更新时间；032公共档案4表；033行政裁定4表；034离线回执1表；035工作人员回执1表。总计127表/35迁移。当前根已落025–031及033–035，032由X08候选实际SQL读取并等待其正式SHA。

新权限清单逐表SELECT/INSERT及最小UPDATE列，不对不可变历史授UPDATE/DELETE；users仅补账号恢复实际password_hash/email_verified_at/credential_reset_at/updated_at，scoring_states仅补professional_stats，不授technical_collection UPDATE。105应用函数精确签名，12个非trigger helper可runtime EXECUTE；触发函数无直接EXECUTE、backup无应用函数EXECUTE、PUBLIC默认EXECUTE撤销；btree_gist extension成员排除，既有schema definer拒绝保留。readiness核对exact函数集合、owner、非definer、runtime/backup/PUBLIC权限。

迁移序列新增纯检查：从001连续且唯一/规范编号，已应用历史必须是精确已知前缀，原checksum验证和事务合同保留，禁止倒插/历史空洞/未知未来迁移。readiness同步连续序列。

本地：完整API tsconfig通过；readiness+迁移计划9单测通过（包括PUBLIC/backup/trigger过权、未知函数、缺号/重复号/倒插）。真实PG/runtime grant执行尚未运行，root将CI执行。后续：动态替换24/83旧硬编码、二进制私密指纹、完整quarantine及P07/重启/非空恢复门槛；各owner已请求受限runtime真实API小fixture。未标DONE。

切片I2：backup/restore返回真实manifest表数，restore在新建库前核对完整表名集合；fingerprint要求当前完整迁移checksum集合且连续，不再固定24；production镜像检查逐SQL文件名和SHA256与源一致，不只比24个数目。重启/生产文案改完整manifest而非83。治理私密附件content与账号邮件加密envelope加入PG内octet_length+sha256指纹，只让元数据与摘要进入Node，实际原始私密字节不入报告/日志。
I2验证：readiness/迁移/私密指纹15项单测通过，production/restart及recovery脚本node --check与格式通过，API完整tsconfig通过（最终重查）。真实dump/restore/运行账户尚未执行。另向root报旧c02-upgrade/c22-region-data测试83断言需修，与我原文件边界分开。
