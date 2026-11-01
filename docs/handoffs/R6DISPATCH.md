# R6DISPATCH 接续

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。独立分支 `work/r6-dispatch`，基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`。

已读取当前设计、AGENTS、协作规范与X12原源预约、共享日历/资源排斥。root负责源预约事务提取与统一048日历扩展；本卡仅追加045派单模型与独立业务消费者。

当前没有PG/Docker执行通道，PG与migration仅编写后交隔离CI；不得把此记录作为测试通过证据。后续切片在本卡与任务文档记录真实命令、结果和本地提交，由root负责同步GitHub。

Slice 1 API typecheck and 21 focused domain tests passed. Broader API invocation included existing readiness tests, which require the root's combined contiguous migration/privilege snapshot update and are not green in this isolated 045 worktree. No PostgreSQL migration execution or CI pass claimed.

Hook: `DispatchOptions.createLocalBooking(c, actor, input: DispatchSourceInput)` returns `{resourceId,version}`. Root implementation will be `LocalServicesService.createDispatchBookingInTransaction`. It must validate persisted ACCEPTED_HELD offer/hash/merchant/terms, use the same transaction, and create source reservation spanning quote `protectedStartsAt` to `protectedEndsAt`; service verifies this and rolls back if missing. Full precise columns and quote shape are exported in `dispatch-service.ts` and `dispatch.d.ts`.
