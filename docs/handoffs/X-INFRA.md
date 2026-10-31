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

I6主接线依赖root先合X18 12d14cc、X12 fd8296a、X22 7d9c38c+5b5eace、X02 08a3f07。capture新域在commerce最终快照前，X02用DRAFT配置hook后GET版本再报名；非空真实行政head保留不伪记分。production远程HTTPS强制runtime；API本地loopback owner显式只作功能数据夹具，绝不算最小权限验收。刷新最终leaderSession及七个exact已知court IDs/DTO；normal新验证在原fingerprint后；quarantine仅停旧新授权不动已确认体育/历史。node语法/格式/空白通过，真正全链未运行。治理评价coverage仍false，若加短时真实履约再单独切片，不伪造COMPLETED。

I7部署测试打包修复：Dockerfile db-tools显式COPY11脚本，.dockerignore scripts/*仅对应11个mjs窄例外；移除validator旧4bind，离线镜像逐source checksum+7helper import核compiled deps，API镜像无测试脚本+真实中文字形探测。X05 checker移除glibc sharp静态依赖，Node PNG流/CRC/metadata校验；真实渲染仍API容器。PNG2单测+tsconfig/格式/语法通过；Docker构建/业务恢复未本地执行。CI131真实P07为20/20，仅packaging缺模块阻TLS业务，下轮重跑。

I7b必要补：checker仅!remoteUrl本地分支dynamic import createApi，防远程Alpine checker无用途加载governance-domain的glibc sharp；真实API仍原glibc镜像。仅语法/格式检查，待实际Docker。

I8依赖local263d25c（第四export captureX12CompletedService）及消息3d9e4c2：显式真实DB钟短履约后创建/独立发布评价，成功才改coverage true；评价core（保留原reviewer）/旧key/版本和完成订单历史在正常/隔离核验。main新增从025+SQL读取新增表清单的全非空门槛，normal/quarantine数量保留。仅语法/格式检查，真实履约与新全链未跑；不会延长或跳过现有失败断言。

CI132亲读：production124415005227 P07两文件20/20，脚本镜像打包与TLS前半业务成功，首错治理附件PUT500，owner按platform_operators SELECT-only锁因修业务，不扩ACL。尚未capture完成/重启/备份恢复，I8亦不在该旧head。035已由x18 helper真实MEMBER命令及原回执整行SHA覆盖。递归静态核查134个非test API TS只可作SQL字面量辅助审查，首轮顶层扫描曾漏子目录，不能当动态SQL/trigger或最小权限通过证明。

I9需同时取c05-commerce-check.mjs与主入口：commerce状态v2保存最终operatorAuthorizations，主入口显式organizationReviewerId=operator0；capture严格核唯一预期本org ORG_ADMIN，其余无org、全员无team，normal精确比较完整上下文。默认独立C05调用仍预期全无机构，不放宽角色。local0fde4f1仅追加C06实际workspace身份/platform角色probe，无授权修改，与I9相容，由root取原片。语法/格式/空白通过，真实PG/重启/restore未跑；迁移不改。

I10及后续infra改在scb-infra-tail / work/completion-recovery-tail，3351b92干净基线创建，旧scb-x05保留不切分支。root独占授权x18 helper。CI133实际通过全新域非空capture（含短时完成/真实评价）、127表物理恢复指纹与I9/template/X08/X05 normal；在x18公开广告hash误包含serverTime失败，未跑完正常业务/隔离。修共用稳定条款hash，仅分离动态serverTime，仍严格核精确字段/type/ISO/有效展示窗口；当前公开DTO无expiresAt，固定起止不排除。新增2回归、语法/格式/diff及映射当前合同的完整API tsc通过，真实新修待下轮CI；业务/迁移/ACL未改。
