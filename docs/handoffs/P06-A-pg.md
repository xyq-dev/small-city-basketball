# P06-A 独立 PostgreSQL 测试记录

## 开工上下文

- 更新：2026-10-22T05:27:16-04:00。
- 负责人：`/root/p01_browser_tests`，集成人 `/root`。
- 目录：`/workspace/scratch/93747c9ad2cb/p06-tests`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 分支：`test/P06-overlay`；开工 HEAD `ca68dea89f1625c86e2a90e43ffa936c49fd6186`。
- 开工状态：仅 root 准备的 node_modules 符号链接未跟踪，其余 clean。已完整读取 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION 和最新 P06-A 合同。
- 独占写入 `apps/api/test/p06*.ts` 与本记录。不改原106PG及support、业务实现、DTO、迁移、根配置或汇总文档；不push。
- 状态：测试源码完成 / LOCAL_ONLY，待root整合及真实PG CI。精确DTO源 `6ebcf188c317da525f02b15ae9525f55debfd5eb` 已按root分发cherry-pick为本worktree `93da89b`；最终测试提交不重复携带DTO。

## 计划与并行

复用现有真实PG保护和生产 scrypt 合成身份、真实HTTP登录；报名冻结、正式赛程与记分/确认通过HTTP。默认夹具没有排名规则或public publication，直接证明Overlay授权独立。只使用验证后的 `scb_test_` 数据库，不清库，不绕过生产守卫或密码成本。

主文件 `p06-overlay.integration.test.ts`：实际STREAMER而非global/match-only/球队grant管理权限、当前个人撤权与既有Grant独立；ISSUE/ROTATE/REVOKE及Event/Grant双CAS、current及历史20截断；public publication独立；审计失败事务回滚；递归有限投影与FINAL来源证明、坏来源仍可管理撤权。

原child `/root/p01_browser_tests/p04_test_review` 完成只读规划；正式唤醒受到thread cap限制，root明确改由既有 `/root/technical_docs` 独占 `p06-sessions.integration.test.ts`：先验secret再复用session、正确secret恢复无效/跨Grant Cookie、歧义Cookie拒绝、精确Cookie属性和硬截止、GET无写、双向撤销/读取真锁竞争、等锁后DB时钟再判、006完整性/不可变约束。共享 `p06-support.ts` 由主负责人独占维护，双方不重叠写入。technical完成8项并交还后，主负责人接手同文件新增第9项INSERT后FK等待到期回归。

锁竞争通过实际 `pg_blocking_pids()` 等待链验证，允许次写者经首写者tuple锁排队；先释放外部事务，再await所有HTTP。过期夹具只允许006接受的初始历史INSERT，created_at/TTL/截止保持一致，绝不UPDATE不可变deadline或添加测试时钟。

## 验证边界

- 已执行：checkout/remote/branch/HEAD/dirty及最新合同核验、旧真实夹具只读复核。
- 已执行：三个新TS文件的Prettier write/check、严格NodeNext TypeScript/noUncheckedIndexedAccess/noEmit，均通过。
- 未执行：真实HTTP+PG、006、重启、浏览器及本卡远端CI。
- 本机仅UID0，不绕过PostgreSQL非root运行保护。真实PG18.6由root隔离CI运行；不以内存库冒充。
- 006由API独占编写，静态审查CLEAR后才由root隔离执行；本分工不编写或执行迁移，不改001–005。

## 2026-10-22T05:27:16-04:00 最终检查点

- 新增17条独立真实PG场景：主 `p06-overlay.integration.test.ts` 8条、`p06-sessions.integration.test.ts` 9条，及共享 `p06-support.ts`。原106PG/support不改，整合后预期123条，真实执行数量和结果以root隔离CI为准。
- 主文件覆盖实际event STREAMER与global/match-only/球队grant隔离、只读eventstaff、当前撤权；命令白名单/Origin/TTL边界及Event/Grant双CAS和跨scope；同场ISSUE真锁竞争单胜、重复请求不恢复secret、轮换/撤销永久失效、20条revoked history精确顺序与截断；已过期未撤销记录原子SUPERSEDED；签发者logout/撤权不撤既有Grant、org inactive与public publication独立；三个授权命令审计失败全回滚及原CAS重试，且Match/统计/lease/fence/赛程/mutex事实不变。
- 有限投影递归精确白名单及finite数值，实际未准备→READY→LIVE/时钟→待确认→FINAL→合法staff升版本→REOPEN，扫描已知内部UUID、synthetic私密姓名/邮箱/credentials；密钥只存hash并仅命令成功返回一次。helpers避免将一次credential放入generic断言失败消息。
- FINAL来源受控损坏覆盖统计、空/旧确认指针、requiresReconfirmation、终局时钟running/remaining/节次；snapshot严格409无私密details，但管理metadata/freshCAS仍可读且ISSUE/ROTATE/REVOKE200并返回previewError。每次受控scoring_state变更finally恢复，不触碰immutable历史或触发器。
- session文件原8条由technical写完并静态通过后交还：先secret后Cookie、复用不增行、invalid/crossCookie恢复、歧义/私有Cookie不能授权；精确Path/Strict/HttpOnly/host-only/Secure和Origin；session截止与Grant精确相等、GET及有效Cookie bootstrap无写/无续期；006合法历史对照后复合FK/唯一/不可变/一次撤销/过期仍唯一；读取先行及撤销先行的双向真锁；Event锁等待跨真实DB deadline后拒绝。
- root独立API审查发现bootstrap INSERT可能额外等待正式match FK锁。主负责人新增第9项：初始合法3秒余期Grant，外部published_matches FOR UPDATE使session INSERT停在KEYSHARE；pg_blocking_pids与pg_stat_activity证明真实INSERT等待，DB时钟过期后释放，预期404且没有新session/任何存储副作用。该测试要求API在INSERT后再次以真实DB时间判期并回滚；修复由API/root独立整合，不降低TTL或UPDATE期限。
- API稳定源 `e6cf0c10c38421d844522603a978cf702c93ceb2` 及006（独立CLEAR的hash `94a54d6a…`）已只读校对，原错误码/列名一致。root负责DI；本worktree未修改app.ts，静态检查不构成HTTP路由已运行。
- 最终静态命令：`prettier --check`三个新TS文件；`tsc --ignoreConfig --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --lib ES2023 --strict --noUncheckedIndexedAccess --esModuleInterop --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --types node`并明确列出三个新文件；staged `git diff --check`。均通过后提交，仅包含三个新测试文件和本记录。
- 本地未运行PG/迁移/重启/E2E，不声称通过；真实DBclock等待写在CI测试中，当前未执行。未push，node_modules符号链接不提交。下一位root：只cherry-pick本测试提交，连同最终API INSERT后期限修复和DI整合，再运行隔离PG18.6原106+新17及其负责的重启/浏览器/独立审查；原生OBS验收另列。
