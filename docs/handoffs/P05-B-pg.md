# P05-B 独立 PostgreSQL 测试记录

## 开工上下文

- 更新：2026-10-22T04:21:43-04:00。
- 负责人：`/root/p01_browser_tests`，集成人 `/root`。
- 目录：`/workspace/scratch/93747c9ad2cb/p05b-tests`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 分支：`test/P05-standings-public`；开工 HEAD `2dd0ba64a20b63cb61919fb1e6e3f3309b5401d7`。
- 开工状态：只有 root 准备的未跟踪 node_modules 符号链接，其余 clean。已完整读取 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、P05-B 合同。
- 唯一允许写入 `apps/api/test/p05b-*.ts` 及本记录；不改旧 88 PG、旧 support、业务实现、DTO、迁移或汇总文档。可静态检查并独立提交，不 push。
- 状态：测试源码完成 / LOCAL_ONLY，待 root 整合及真实 PG CI。API 精确 DTO 已分发并按 root 授权 cherry-pick，源 `d34bbc688acbf6e6f21cd64fda3841cc414108da`，本 worktree `4e737f4`；最终测试提交不重复携带契约改动。

## 计划和分工

复用 P04/P05-A 的真实生产密码哈希、合成身份 SQL 夹具和真实 HTTP 登录，报名冻结、赛程发布、记分与独立确认均通过 HTTP。只连接经 `scb_test_` 前缀及 current_database 双重验证的测试库，不清库，不引入测试生产开关。

主负责人维护 `p05b-support.ts`、`p05b-standings.integration.test.ts`：规则草稿 CAS/显式发布与永久锁、正式确认资格与历史唯一计入、FINAL 工作人员元数据修改不撤赛果、重开移出/重确认恢复、共享名次和零场 rank null、来源损坏拒绝、确认/重开与榜单读取一致性。

复用既有 child `/root/p01_browser_tests/p04_test_review`，独占 `p05b-public.integration.test.ts`：匿名精确白名单及私密数据边界、公开启停及身份轮换、全部公开场次映射和数据库约束、scope 游标、角色隔离、公开读取/撤销真实锁竞争、审计失败回滚。DTO 与 helper 稳定后再实施，不同时写文件。

并发场景通过 `pg_blocking_pids()` 观察真实等待，不使用固定长 sleep。外部事务清理先 rollback/释放锁，再等待所有 HTTP 请求结束，避免断言失败挂住 suite。私有和匿名响应独立校验，不能以 sourceMatchVersion 等于当前 matchVersion 作为正式资格判断。

## 验证边界

- 已执行：实际 checkout/Git/权限路径核验、合同与现有真实夹具读取。
- 尚未执行：P05-B 格式/类型、真实 HTTP+PG、迁移005、重启、浏览器及远端 CI。
- 本机只有 UID0，不绕过 PostgreSQL 非 root 运行保护，不以模拟库冒充 PG。真实 PostgreSQL 18.6、重启与浏览器由 root 在隔离 CI 验证。
- 005 由 API 负责人独占，本分工不编写或执行迁移；不改变已应用001–004。

## 2026-10-22T04:14:20-04:00 检查点

- `p05b-support.ts` 已完成精确路由/DTO helper、正式记分确认夹具和统一外部行锁清理 helper；所有比赛结果仍由 HTTP 真实记分和独立确认产生。
- 主文件已写 8 条：显式规则和草稿历史/永久锁、并发草稿/发布 CAS 单胜、零场与部分 draw 的 1,1,3、三队循环全共享第1、FINAL staff 升版本仍计入且 hash 稳定并验证重开/重确认只计最新历史、4种FINAL损坏来源私有/匿名拒绝、在途重开前后原子读取、私有实际角色与当前撤权。上述若干并列要求合在同一业务场景，不重复计数。
- 主文件及 support 首次 Prettier、严格 NodeNext TypeScript/noUncheckedIndexedAccess/noEmit 通过。公开文件已有前6项 HTTP/白名单场景，child 继续审计/真锁竞争/005约束，尚未作全量最终静态通过结论。
- 已只读核对 005 初稿和 standings-domain/source 单SQL LEFT JOIN。发现初稿缺规则发布分支错误码不符先前稳定约定，已反馈 API；测试保持 422 STANDINGS_RULES_REQUIRED，不放宽断言。
- 仍未执行本地 PG、迁移、重启或浏览器。下一步完成公开文件并按最终服务/005复核，完整静态检查后只提交测试与本记录，由 root 运行真实 PostgreSQL 18.6 CI。

## 2026-10-22T04:20:03-04:00 最终交付

- 新增 18 条独立 PG 场景：`p05b-standings.integration.test.ts` 9 条、`p05b-public.integration.test.ts` 9 条；共享夹具 `p05b-support.ts`。原 88 条测试及 support 原样保留，整合后预期 106 条，实际执行数量和结果由 CI 给出。
- 主文件在上述8项基础上补规则 SAVE/PUBLISH 审计故障全回滚、无孤立草稿/指针及原 CAS 可重试；规则范围同时覆盖两个不支持的赛制、SQL不可变规则/永久锁。
- 正式来源测试严格覆盖 current pointer、reconfirmation flag、统计及最后确认来源链。受控 SQL 将同比分 current pointer 暂时指回旧确认仍须拒绝；FINAL 合法 staff 元数据升版本仍计入且 hash 不变，不使用 sourceMatchVersion 等于运行版本的错误捷径。
- 技术复核新增 FINAL 时钟三变体：running=true、remaining_ms>0、period<regulationPeriods。夹具真实完成两节再确认，每个破坏独立 finally 恢复；私有及匿名均预期409 RESULT_SOURCE_INVALID且公开错误不含私密详情。坏来源仍可凭已知 fresh CAS 撤销公开链接（200且standings:null）。
- 公开文件完成递归精确字段白名单、known内部UUID和私密synthetic资料/凭据扫描；未准备null与READY显式0；启停及全新public event/match/team键、跨赛事球队key隔离、scope/filter绑定分页；实际角色/Origin/当前撤权；启停审计故障全回滚；读先行和撤销先行两向可观察锁竞争；005完整map合法对照与不完整/FK/不可变/禁止复活恶意 SQL。
- 所有锁竞争以实际 pg_blocking_pids 验证，清理先释放外部事务再等待请求。审计trigger/function限定本合成机构/赛事且 finally 清理，不添加生产测试开关。
- 已执行三个新TS文件 Prettier格式和严格NodeNext TypeScript/noUncheckedIndexedAccess/noEmit，以及diff空白检查；均通过。精确命令以 `./node_modules/.bin/prettier --check apps/api/test/p05b-*.ts` 和 `./node_modules/.bin/tsc --ignoreConfig --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --lib ES2023 --strict --noUncheckedIndexedAccess --esModuleInterop --skipLibCheck --experimentalDecorators --emitDecoratorMetadata --types node apps/api/test/p05b-support.ts apps/api/test/p05b-standings.integration.test.ts apps/api/test/p05b-public.integration.test.ts` 执行。
- 本地没有可安全启动的 PostgreSQL，未执行P05-B真实HTTP/PG、005、重启、浏览器或远端CI，不声称这些检查通过。早期缺规则发布错误码和005算法默认值疑问已与API校准；最终INSERT显式常量由API负责，不改迁移hash。
- 本次只提交三个新TS测试文件及本记录，不重复带DTO提交，不push，node_modules依赖符号链接不提交。下一位root第一步：仅cherry-pick测试提交，整合最终API/005及app接线后在隔离PG18.6跑完整原88+新18场景，再落实其负责的重启/浏览器与独立审查。

## 2026-10-22T04:21:43-04:00 并发屏障复核修正

- API 独立只读审查发现 PostgreSQL 第二个 Event FOR UPDATE 写者可能排在首个写者的 tuple 锁后，并非两个都直接由外部事务阻塞。原 rows.length=2 的直连阻塞断言可能产生测试假阴性。
- 保存首写者真实 PID；第二写者必须是另一 PID，且实际 blocker 包含外部事务或首写者，确认等待链后才释放外锁。200+409 VERSION_CONFLICT、CAS、不可重复草稿及单次审计断言不变，不删除竞争场景或以 sleep 替代。
- delta 仅改自身 standings 测试及本记录，格式/严格类型/diff 检查后独立提交；本地仍未执行 PG。
