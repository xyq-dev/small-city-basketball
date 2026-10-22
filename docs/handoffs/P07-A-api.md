# P07-A API交接

2026-10-22，负责人/root/p01_domain。IN_PROGRESS，LOCAL_ONLY。

已核验目录/workspace/scratch/93747c9ad2cb/p07-api，远端https://github.com/xyq-dev/small-city-basketball.git，分支feat/P07-runtime，exact baseline f2bf36585f09a0e55df41328a1d25f33e479e012；初始仅未跟踪的root node_modules软链接。已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION及[P07-A](../tasks/P07-A.md)。不push、不改001–006和比赛状态机，不写PG/打包/UI路径。

首合同提交5df73bbf364dcc24611846aa23194cff90c386fd：AuthCapabilitiesData恰好canRegisterOrganization/canRegisterParticipant，ApiOptions追加两个注册开关与trustProxyHops0|1；旧registrationEnabled明确fallback，同值可并存、冲突拒绝，生产双关闭且Secure不能false。root已分发接口。

PG manifest d942b63a794585418647efc25525c8173c683e2e按root授权cherry-pick为f6c4d28，只读消费39表显式ACL，后续提交不重带PG变更。API独占runtime-config/readiness/bootstrap-owner和必要旧入口及相关测试。

已完成：生产配置与secret文件读取、固定503就绪、首owner事务及compiled入口。owner严格JSON四字段email/password/displayName/organizationName，经BOOTSTRAP_OWNER_INPUT_FILE或boundednonTTY stdin，不接受argv/inline输入；API/migrate/owner均DATABASE_URL或DATABASE_URL_FILE二选一，对应job挂不同secret。生产createApi启动执行只读readiness，直接Service构造也使用同一生产默认，不以main为唯一保护。GET /v1/auth/capabilities标准envelope只含两个布尔；GET /ready成功data为status:ready，任何失败固定503 SERVICE_UNAVAILABLE。健康检查保留health的SELECT1。

readiness比对全部迁移名/checksum精确集合、btree_gist、current_user与session_user均为scb_runtime、无危险角色或角色成员关系／owner／schemaCREATE／DBCREATE／TEMP及replication-role设置权。逐表／逐列核对manifest，禁止额外whole-tableUPDATE、额外列写、TRIGGER/TRUNCATE/REFERENCES/MAINTAIN及越界关系或序列授权。只读事务无迁移或写入；错误不携SQL、role、URL或cause。

bootstrapOwner(pool,body)导出给真实PG验证。输入校验后生产强度scrypt；事务先锁users再organizations（与现注册user→org顺序一致），任何org存在409 BOOTSTRAP_NOT_EMPTY、既有邮箱409 EMAIL_ALREADY_EXISTS；原子新user/org/OWNER与BOOTSTRAP_OWNER审计，不调用register、不建session。compiled migrate直接执行有CLI，import migrate(pool)无副作用。main及两个CLI顶层失败只输出固定文案，SIGTERM/INT关闭HTTP后finally关闭pool。

因严格DBURL验证，三份旧transport测试仅将unused占位值替换为其已存在Pool使用的合法未连接port1URL，断言未放宽。001–006、比赛状态机及PG/打包/UI文件不变。

2026-10-22 UTC本地实际验证：API16文件227测试全通过（上游201＋新增26），完整API typecheck/build通过。新增覆盖生产直构造默认／独立开关／兼容冲突、严格origin／整数／secret二选一、完整迁移集合／ACL纯判定、owner bounded私有输入、匿名capabilities／Origin保留、proxy0/1的真实HTTP地址提取及固定readiness503、源CLI argv/URL/input保密。另直接执行compiled main/migrate/owner，三者对含canary的畸形DBURL均退出1且仅固定错误；compiled迁移模块导入无CLI副作用。未把HTTP limiter mock当作真实代理／PG证明。

真实PG角色/ACL、并发、审计回滚／CLI及容器/TLS/secret挂载/SIGTERM/恢复均未本地执行，待root当前head CI。当前源码可审查，尚无本卡最终完成证据；无新migration。下一步独立审查后root串行整合，真实CI验证实际权限SQL与完整打包链，失败另行小补丁。

## 连接恢复检查点（2026-10-23 Asia/Shanghai）

接续负责人 `/root/resume_api`，原目录／分支／HEAD `5df73bb` 核验一致，保留原有全部未提交源码与回归后继续。当前root已获原项目Git授权，本分工仅本地commit，push／整合由root执行。重新执行API typecheck、build、16文件227源码／HTTP／纯测试，全部通过；不将先前作者报告当成本轮实测。当前提交仅固化已有P07实现，未改001–006、业务状态机或PG/打包/UI，真实PG与容器验收仍待root。

另已确认PR2的scrypt并发与过期限流清理仍有缺口，将另补安全修复及回归，不把该缺口写为已解决；赛事编辑冲突交UI负责人处理。

## PR2安全补查修复（2026-10-23 Asia/Shanghai）

- `security.ts`：所有hash/verify（含未知账号虚拟校验与bootstrap）共享单进程一个scrypt槽位，最多16个等待。保留原N/r/p/盐与编码，不降低密码强度；超载、同步异常或回调失败均返回固定503 `AUTH_UNAVAILABLE`，不含底层异常或cause，finally释放后续槽位。
- `service.ts`：每次认证计数前按最长现行窗口一小时清理过期键，单次最多100条，真实行锁`SKIP LOCKED`。清理独立Pool.query自动提交后再执行原子upsert，不能持有其他key锁进入本key计数；独立审查指出的合并CTE交叉锁风险已消除。未改变注册20/小时、login-IP100/15分钟、account10/15分钟的规则。
- 新增3项受控worker资源回归覆盖全局串行、hash/未知账号verify共用队列、队列拒绝后恢复、同步／回调错误释放与保密；原真实scrypt随机盐和验证回归继续通过。旧runtime HTTP代理测试只统计计数upsert，避免把新清理SQL误当作IP身份取证。
- `security.integration.test.ts`新增真实PG回归：过期login/account/register清除、30分钟仍活跃注册限额保留、当前过期键从1原子增至3、两个过期键并发准确各1。该PG用例本地尚未执行，须root隔离PG CI验收，不能以源码230测试替代。

本轮最终本地API typecheck、17文件230源码/纯/HTTP测试通过；API build及完整`tsc --project tsconfig.tests.json`、显式文件Prettier与diff检查按命令结果交root。无新增/修改Migration，无生产操作，不push。
