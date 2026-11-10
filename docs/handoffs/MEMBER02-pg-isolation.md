# MEMBER02 · 真实 PostgreSQL 测试隔离

2026-11-10 17:59 Asia/Shanghai；作者 `membership_audit`；REVIEW / LOCAL_ONLY。

## 原因与现场

root 已读取 CI256 API 证据：R6 147、会员26项通过，旧组640通过/1失败；失败的旧 C05 全账单核对发现7笔 LOCAL_ONLY。原因是会员组先在同一个控制库留下真实付款/退款事实，而旧 C05 固定账单仅列自己的交易。业务全账本核对正确；本修复不改旧断言、不按机构/目标过滤账本、不清理旧数据。

独立工作目录 `/workspace/scratch/dc6a786e1a31/scb-member02-pg-isolation`，origin `https://github.com/xyq-dev/small-city-basketball.git`；分支 `fix/member02-postgres-isolation`，基线 `fb2dec503d0f83667ca0658e87a99c3bd229f5ab`，开工干净。root 的其他 worktree 和未提交文档保持。仅写新 runner、直接 guard 测试及本记录；CI、package、业务、原测试、Migration 均未改。

## 实施

- `scripts/run-membership-postgres-checks.mjs` 只从显式 TEST_DATABASE_URL 读取控制库；连接前要求非 production、PostgreSQL、loopback、未编码的63字以内 scb_test_* 库名、无 query/hash。拒绝 URL 文件或 DATABASE_URL 回退，只接受无参数或单个 `--verify-cleanup`。
- 只读核验控制连接的 current_database/OID，并在 READ ONLY、REPEATABLE READ 事务内记录全机构完整软件账本、购买期和 first_run_setup 的存在性/行数/聚合摘要；摘要与行值不输出。
- 随机创建全新 `scb_test_member02_` 专库，CREATE 成功才认领，记录 OID、实际连接身份。绝不接管同名已有库。若身份不能证明则失败，不擅自删除。
- 正常 child 固定为当前 Node + 本仓库 Vitest CLI，cwd 为 apps/api，只执行 `member02-membership.integration.test.ts`、`member02-native.integration.test.ts`。TEST_DATABASE_URL、DATABASE_URL 同时指向新库，并清除两种 URL_FILE 回退；不接受调用方提供额外命令或测试参数。
- child 结束（成功、失败或中断）后 finally 核对新库 OID，再执行普通 DROP DATABASE，未使用 FORCE 或终止其他会话。随后核实专库不存在、控制库同一 OID仍存在、原账本/首次初始化聚合摘要不变。控制库没有业务写入。
- 正常子进程退出码保留；SIGINT/SIGTERM 传递，使用相应非零退出码。`--verify-cleanup` 使用固定 Node 子进程退出23，只有真实专库清理与控制库保全验证完成后才返回23。清理/身份/保全失败统一返回1并仅输出固定错误，不泄露驱动报文、连接串、凭据或 SQL 绑定值。

## 实际验证与限制

- `node --test scripts/run-membership-postgres-checks.test.mjs`：5项通过，0失败/跳过，覆盖合法两模式、坏/隐式/远程/production目标与参数在创建pool前拒绝、没有生产URL回退、CLI错误脱敏。
- `node --check` 两份新 mjs：通过；新文件 `prettier --check`、`git diff --check`：通过。
- 本切片仅 mjs/Markdown，无 TypeScript 修改；现有 tsc 配置不包含脚本，不把无关类型成功冒称该脚本的类型证明。
- 本机没有运行 PostgreSQL；真实 CREATE/DROP、两个会员文件26项、非零 child 清理及控制库不变性均留待 root 新候选隔离 CI，不用纯 guard 或 mock 算真实执行。
- 无新/已执行 Migration，无生产数据库、部署、资金、凭据或公网操作。本切片仅精确本地提交，不 push。

## root 接续

将 CI 会员步骤替换为 `node scripts/run-membership-postgres-checks.mjs`，保持 R6 → 专库会员 → 旧组原样。把新 guard 文件加入纯脚本检查。额外运行 `node scripts/run-membership-postgres-checks.mjs --verify-cleanup`，显式捕获并要求退出码恰好23；任何0/1或其他码均失败。新CI还须确认旧 C05 exact.issues 继续严格为空，完整账单守卫未放宽。
