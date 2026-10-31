# X-INFRA交接

root批准infra独占见docs/tasks/X-INFRA.md。先接本片manifest127表/105应用函数（12helper runtime EXECUTE）；依赖完整025–035，尤其032公共档案4表与x08_public_archive_guard签名，不能在缺032时运行迁移/生产readiness后误判通过。所有当前新增表/列权限已按各owner逐一核对，不为SELECT行锁扩大immutable UPDATE；X05已另用80f2fc2去不必要锁，X03另修026。

本片函数ACL适用于全部non-extension public应用函数，精确登记trigger+helper身份；btree_gist扩展函数保持其所需权限，禁止SECURITY DEFINER；普通runtime仅12非trigger helper执行，backup不执行应用函数，PUBLIC不执行。readiness核对权限；原table列权限核对保持。

迁移计划保留既有事务/checksum合同，加连续唯一规范序号与已应用前缀检查。9单测与API tsconfig已通过；PG/grants/restore均尚未执行。后续片继续更换hardcoded24/83、隔离所有新公开授权/找回邮件任务与token、保留私密历史且不输出，真实运行交根CI。

I2去除所有本组backup/restore/fingerprint/production/restart旧24/83硬编码。镜像逐SQL文件名/checksum对源；restore新建前exact表名集合，返回真实表数。私密工单附件bytea与邮件envelope在PG内摘要，报告只长度/摘要与元数据。15个本地单测通过；脚本语法/格式与API tsconfig通过；无PG/dump/restore实际结果。root需另改旧c02/c22固定83测试（已告知）。

I2b：c02/c22 exact当前迁移suffix/manifest表集合，C22历史列比较排除028/031中性新列；c19 EXPECTED_NEW_COLUMN_VALUES显式false/null新列。无真实PG升级运行结果，根CI执行。

I3依赖X12 E@25b7fc8新增checkin两列，根须先整合该027? 实际为029候选。quarantine锁完整manifest且NOWAIT，新增所有独立公开授权/城市权/账号token+邮件envelope/同城供给订单约赛库存核销永久关闭；不删私密历史，不动已确认行政head/回执。P07锁竞争观察正则兼容带引号完整table锁。19本地infra单测+tsconfig/语法格式通过；真实PG尚未执行。CI129 production固定migrate-and-grant失败，不代表HTTPS/restart/restore执行过。非空新域fixtures和受限runtime actual API下一片继续，不能标DONE。

I4a接X03/X08独立helper入capture/verify/quarantine，依赖root已合两helper（0c95340/80ff930），X08使用独立新赛事，原主事件既有恢复断言不变。P07新增真实受限runtime正向helper与PUBLIC/backup/trigger过权/immutable写拒绝门槛，未执行；本片语法/格式及tsconfig检查，真实CI重跑待033语法修后。X05/X12/X18非空数据下一片。

I5 x05-recruitment-check接capture/normalverify/quarantine，state.x05仅非密refs/hash，无新cookie/公开key原文/PNG字节；capture真实6表非空与PNG，normal下载审计放原fingerprint后，quarantine只读SQL+匿名404，保留永久回执/已接受历史。仅语法/格式检查，未真实运行。待X12/X18/X22 helpers交付串接主链，root后续CI实际验证。

CI130后修：P07 C22 barrier兼容031 actor users u + credential timestamp谓词，保持真实锁竞争/原5秒与全库回滚断言。2个本地观察语义测试通过；P07真实门槛此前18/19（只该barrier超时），HTTPS/重启/restore未运行。请CI重跑。

CI130 API修：c02残留24与c22 legacy恢复后缀已改exact source迁移集合；不改冻结78表旧包。X05 PM fixture补合成合法结构身份号码遵C23，不放宽核验。只类型/格式检查，PG重跑待CI，API130原为468pass/8fail/5skip未通过。
