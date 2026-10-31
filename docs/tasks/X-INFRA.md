# X-INFRA 025–035运行权限与恢复门槛

2026-10-31；root交completion_recruitment负责。仅本地切片commit，root串行cherry并同步GitHub。

状态IN_PROGRESS。root批准文件所有权：runtime-privileges.json、readiness及测试、database/migrate及migration-plan；ops/db/privileges；ops/recovery backup/restore/fingerprint/quarantine及types；production/restart脚本；P07 runtime/quarantine测试及独立completion fixtures。禁止业务app/service/ui和旧迁移001–024。

已核对owner清单：025第三名无新表；026模板4表；027招募/邀请/海报6表；028技术统计仅scoring_states/result_confirmations新增技术字段；029同城7表；030治理/广告/经费12表；031邮箱找回5表与users验证/凭据更新时间；032公共档案4表；033行政裁定4表；034离线回执1表；035工作人员回执1表。总计127表/35迁移。当前根已落025–031及033–035，032由X08候选实际SQL读取并等待其正式SHA。

新权限清单逐表SELECT/INSERT及最小UPDATE列，不对不可变历史授UPDATE/DELETE；users仅补账号恢复实际password_hash/email_verified_at/credential_reset_at/updated_at，scoring_states仅补professional_stats，不授technical_collection UPDATE。105应用函数精确签名，12个非trigger helper可runtime EXECUTE；触发函数无直接EXECUTE、backup无应用函数EXECUTE、PUBLIC默认EXECUTE撤销；btree_gist extension成员排除，既有schema definer拒绝保留。readiness核对exact函数集合、owner、非definer、runtime/backup/PUBLIC权限。

迁移序列新增纯检查：从001连续且唯一/规范编号，已应用历史必须是精确已知前缀，原checksum验证和事务合同保留，禁止倒插/历史空洞/未知未来迁移。readiness同步连续序列。

本地：完整API tsconfig通过；readiness+迁移计划9单测通过（包括PUBLIC/backup/trigger过权、未知函数、缺号/重复号/倒插）。真实PG/runtime grant执行尚未运行，root将CI执行。后续：动态替换24/83旧硬编码、二进制私密指纹、完整quarantine及P07/重启/非空恢复门槛；各owner已请求受限runtime真实API小fixture。未标DONE。

切片I2：backup/restore返回真实manifest表数，restore在新建库前核对完整表名集合；fingerprint要求当前完整迁移checksum集合且连续，不再固定24；production镜像检查逐SQL文件名和SHA256与源一致，不只比24个数目。重启/生产文案改完整manifest而非83。治理私密附件content与账号邮件加密envelope加入PG内octet_length+sha256指纹，只让元数据与摘要进入Node，实际原始私密字节不入报告/日志。
I2验证：readiness/迁移/私密指纹15项单测通过，production/restart及recovery脚本node --check与格式通过，API完整tsconfig通过（最终重查）。真实dump/restore/运行账户尚未执行。另向root报旧c02-upgrade/c22-region-data测试83断言需修，与我原文件边界分开。

I2b兼容门槛：root授权c02/c22旧测试从固定008–024/24迁移/83表改为exact当前已知迁移suffix与manifest表集合，旧行仍精确比较；C22只剔除新中性字段用于历史列比较，C19新列常量显式加入专业字段false/null、邮箱验证/凭据时间null。未把旧历史断言放宽为任意默认值。完整API tsconfig及格式通过；这三份真实升级测试未执行。

I3离线恢复隔离：先对完整manifest127表一次EXCLUSIVE NOWAIT锁（任何冲突在主体写入前回滚）。永久撤销招募、本届待接邀请、海报导出、公共档案key/profile/source、城市运营权、赞助公开与活动、经费公开与账号、评价；账号所有动作token撤销、未决/未知邮件任务EXPIRED并清加密envelope/lease，防恢复后重发。关闭同城供给/时段，未履约预约取消、已到场/交付转争议，未决约赛取消，全部库存ledger释放，核销hash/expiry清空并断言无遗留。保留私有工单/附件/账目/所有原请求/离线回执/模板历史/已独立确认行政裁定head，不直接重写体育行政事实。原C23宣传撤回与旧凭据隔离保持。
依赖X12 E@25b7fc8，029新增checkin_hash/checkin_expires_at列，manifest只加这两个实际UPDATE字段；DB保证只有CONFIRMED可留hash，历史终态不改。19个本地infra单测（含锁冲突、审计失败、核销遗留固定错误及整体回滚）通过，API完整tsconfig与脚本语法/格式通过。真PG/quarantine/restore未执行；CI129生产已在migrate-and-grant失败，尚未进入恢复，正在排根因。

I4a：将X03模板创建/固定版本实例化/原编号重放与X08专业比赛+永久离线意图+公共TEAM档案撤回/重发真实HTTP helper接入production/restart主链。X08另建独立合成事件，避免打完原事件最后未准备场破坏原rescheduling/viewing/OBS证据；主状态存X03配置回执及X08非密refs/hash/version，正常恢复原fingerprint核对后再验证，quarantine检所有旧档案key失效/离线ledger不变。另P07真实runtime新增helper正向执行、PUBLIC/backup/直接trigger授EXECUTE失败readiness、immutable表行锁及UPDATE拒绝；尚未执行。
I4a脚本语法/格式、API tsconfig通过（最终重查），依赖root已接scripts/x03-template-check与x08-archive-check。CI129首因已定位033长IF CASE语法，由X01修，所有新PG与production此前只证明迁移阻断，无下游功能/恢复结果。继续X05/本地供给/治理非空fixtures，未标DONE。

I5：新增x05-recruitment-check真实runtime HTTP helper并接主链：赛前独立招募→本人申请→独立DRAFT批准→逐行预览→原ID整批提交重放→本届本人接受→保留待接邀请，以及正式独立确认赛果海报生成/实际PNG下载。新6表全部非空；state只存ID/源hash/PNG摘要，公开招募key从DB重取不新增原文，图片不落state。正常重启/restore核原回执与真实PNG字节相同；quarantine旧招募404/待接邀请REVOKED/已接历史不改/海报revoked/原回执和预览保留。下载核权会写审计，因此正常验证放原fingerprint相等之后。
I5脚本语法/格式与git diff --check通过，真实HTTP/PNG/PG未执行（第一轮CI被033语法阻断）。X12、X18、X22非空helper已分别协同local、scheduling、competition并行编写；我保持主入口/infra所有权，待单独SHA根整合后接线。

CI130真实门槛：migrate-and-grant已通过，P07 runtime文件与大部分quarantine合计18/19通过；唯一C22竞争测试barrier超时。已定位lockActor在031账号恢复加入users别名/credential_reset_at谓词，旧测试等整段无别名SQL而没暂停真实请求。修正仅观察语义（users本人$1且FOR SHARE），仍等实际SQL成功后暂停，保留5秒NOWAIT拒绝/全库不变/排空后重试全部断言；不延时、不跳过、不改业务锁。2单测覆盖旧/新/多行语句与非actor/无锁拒绝，真实PG重跑待CI。尚未到HTTPS/restart/full restore。

CI130 API真实结果468通过/8失败/5跳过（整体未过）。本组后续修正：c02 checksum拒绝测试残留24条断言改完整source迁移名集合；c22 frozen legacy恢复升级残留023/024后缀改完整source>022精确集合，冻结旧78表包与原历史数据断言保留。X05照片真实PG资料提交失败IDENTITY_REQUIRED，按C23补四个非真实990000区码/有效日期和校验位的合成身份，不降低真实身份/照片/独立审核要求。完整API tsconfig/格式通过，以上真实PG待CI重跑。

I6主入口已接X12/X18/X22非空helpers及X02行政裁定：同城两新队/独立审核供给/真实预约库存/双队约赛/仅哈希核销；工单私密附件/城市权/赞助曝光/双人经费公示；实际AccountRecoveryService产生五表邮件密文/token/request/cancel/config且不启动worker不发外部邮件。production HTTPS默认严格scb_runtime；API job本地仅loopback HTTP/DB明确owner模式，不把本地owner当最小权限证据。X02独立新赛事在DRAFT hook先配规则再重读版本，后冻结排程并独立提议/批准，真实head/四表回执hash在normal/quarantine不变，不伪记分或清裁定。全部新商业激活发生在最终commerce基线前。
新增fixtures会增加真实球场，最终courts先断言exact七个已知原/新增ID无额外行，再保存完整DTO并在恢复精确比较；原leaderSession也在全部新grant后重抓。新私有/公开GET可能写审计或限流，normal新helper验证统一放原完整fingerprint相等之后。治理评价仍明确coverage:false（未伪未来订单完成），local正评估可用真实短时履约另补。
依赖helper：X18 12d14cc、X12 fd8296a（G2 ada057+E列）、X22 7d9c38c+5b5eace、X02 08a3f07。主脚本node --check/Prettier/diff通过，真实HTTP/PG/restart/dump/full-restore尚未运行，等待下一CI头。

CI131生产真实结果：P07两文件20/20通过，API启动3300，TLS业务链尚未开始业务就因validator容器缺x03 helper而ERR_MODULE_NOT_FOUND。根授权Dockerfile/测试镜像清单补齐；发现.dockerignore原排除整个scripts也需窄例外。现db-tools镜像明确COPY11个验收脚本/依赖，.dockerignore只放行这些mjs，validator移除旧四个脚本逐个bind避免漏挂/漂移，镜像离线逐源checksum并import7域helper检查compiled dist依赖；应用API镜像不包含测试scripts，且额外实际中文glyph probe。
I7同时删除checker对glibc sharp的静态import，避免Alpine db-tools复用API生产依赖时libc不匹配；只用Node内建检查实际PNG签名、尺寸、完整chunk流/CRC与无EXIF/text。真正渲染仍在有Noto的API容器，未换模板或生成来源。2个本地真实Sharp PNG→portable verifier测试通过（CRC/截断/尺寸/JPEG/EXIF负向），完整API tsconfig、脚本语法/格式通过；本地无Docker，不声称新镜像构建/HTTPS业务/重启/完整恢复已通过，等待CI重跑。

I7b：进一步只读发现新治理domain合法静态导入sharp，旧checker顶部静态createApi会把完整应用（含glibc sharp）加载进Alpine db-tools，即使remote模式根本不启动API。改为仅本地API job分支动态import createApi；production远程只运行HTTP/SQL验收helper和独立mail service，不加载治理图像addon。真实应用API代码不改。脚本语法/格式检查通过，Docker实跑待CI。
