# MEMBER01 后端：按届权益只读状态投影

2026-11-10 15:28 Asia/Shanghai；作者 `membership_audit`；REVIEW / LOCAL_ONLY。本记录为分支切片，不表示 main、CI 或生产已完成。

## 现场与范围

- 工作目录 `/workspace/scratch/dc6a786e1a31/scb-membership-status`，远端 `https://github.com/xyq-dev/small-city-basketball.git`；分支 `feat/member01-entitlement-status`，基线 `fb6cc396f42022189156f4d979ae1d32662747b8`，开工无未提交修改。
- root 为唯一集成人；已读根 AGENTS、协作规则、CURRENT_STATUS、TASKS 与 MEMBER01 任务卡。仅写 commerce service、新状态纯函数及测试、原 C05 PG 集成与本记录。共享 contract 由 root 提供，本切片没有修改。
- 原因：未激活权益即使超过截止期，旧页面仍只能显示泛化的“待激活”。本切片由服务端以数据库时钟给出展示投影，客户端无需用本机时间猜测可以激活。

## 已实施

- `apps/api/src/commerce/service.ts` 原权益查询仍保持机构过滤、原事件关联、排序、100 条上限与读取权限；加入原订单的 id/org/event 三重归属关联、订单状态和 `clock_timestamp()`，在同一条 SQL 返回的事实中投影。
- DTO 新增可兼容的 `activationStatus` 与 `statusCheckedAt`；没有新增储存状态、定时器、端点或写入。原订单/付款/退款/激活守卫完全不变。
- 新 `commerce/entitlement-status.ts`：有效撤销优先，其次已激活继续使用，再次退款待核验；其他未付款或坏资料为 UNAVAILABLE。未激活且已付款时，截止时间小于或等于数据库核对时间为 EXPIRED，之后才为 READY。函数不读取进程时钟；接受 PG Date 和有时区的 ISO 时间，拒绝坏时间与日期自动归一化。
- 新直接测试 28 项，覆盖毫秒边界、相等、时区等价、指定数据库时刻、已激活过期继续、状态优先级、非 PAID 与坏时间/坏布尔/缺字段。
- 原 `c05-commerce.integration.test.ts` 的合法人工到账、首次发布、退款申请与独立确认退款链增加 READY/ACTIVATED/REFUND_PENDING/REVOKED 断言。核对时间位于读取前后的数据库时刻之间；原订单、权益、激活、退款、审计与商业回执数读取前后完全相等。
- EXPIRED 没有通过停用触发器、篡改付款时间或修改财务历史伪造 PG 夹具；精确期限边界目前是纯函数覆盖，不能称为已完成真实 PG 过期场景。

## 实际验证

- `npm run test --workspace @small-city-basketball/api -- --run apps/api/src/commerce/entitlement-status.test.ts`：该项目脚本含 `vitest run src`，实际跑完整 API 源码，125 文件、1425 测试全部通过（原 1397 + 本次 28），无失败或跳过；耗时 54.93 秒。
- `npm run typecheck --workspace @small-city-basketball/api`：通过，包含修改后的 PG 集成测试类型检查。
- 四个业务/测试文件 `prettier --check`：通过；`git diff --check`：通过。
- PG：本机没有可用隔离 PostgreSQL，本轮未执行集成测试，没有把缺环境失败或 skipped 算作通过。由 root 运行既有隔离 CI。
- 没有运行真实商户支付、浏览器或生产验证；源码与类型通过不能替代这些证据。
- 为本地验证创建了指向 root 已有依赖的临时 node_modules 符号链接，验证后仅解除本切片自己建立的链接，没有修改依赖或锁文件。

## 操作与下一步

本切片仅本地精确提交五个允许路径，由 root 整合、独立审查和隔离 CI 后同步。未 push、PR、merge、部署或生产数据操作。无新 Migration，编写与执行均为 0；001—051 不变。

下一位 AI：先读取本分支最新提交与差异，整合到 MEMBER01，再运行既有 C05 真 PG 组并核对本轮新增的状态和零业务写入断言。前端应读取投影；旧 API 缺字段时显示中性“请刷新核对”，不能用本机时间推断 READY。
