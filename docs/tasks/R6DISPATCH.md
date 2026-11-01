# R6DISPATCH：跨城派单实现

状态：IN_PROGRESS；integration：LOCAL_ONLY。负责人：`/root/implement_dispatch`；2026-11-01 Asia/Shanghai。

基线：`c61ab3667c9d3f756244a28046b9ee2395ccac00`；目录 `/workspace/scratch/aad368826b09/scb-six-dispatch`；分支 `work/r6-dispatch`；开工工作区干净，origin 为目标 GitHub 仓库。

允许：派单领域/持久服务/控制器、独立契约、045迁移、小程序派单页面与测试、本任务交接。共享入口、源订单事务和048共享日历整合由root负责。旧迁移、生产、真实资金/外发、外部凭据均禁止修改。

目标：双侧许可、有限邀请批次、报价审核、客户确认、单赢家/共享档期锁、同事务源订单转换、差旅保护、撤回过期、幂等恢复及角色UI。

计划验证：领域/权限/状态单测、小程序VM、API类型检查；真实PG并发和HTTP集成测试编写交隔离CI。当前未执行测试或迁移，未推送/合并。

### Slice 1 — 2026-11-01

- Added strict contracts/domain, durable dispatch service/controller, migration 045 and independent travel-review/quote-hold state machine.
- API typecheck passed. Focused `../../node_modules/.bin/vitest run src/dispatch-domain.test.ts` passed **21/21**.
- PostgreSQL/migration execution not available locally. Source hook remains injected and fail-closed until root wires `LocalServicesService.createDispatchBookingInTransaction`.
- Next: native workflow/recovery, PostgreSQL lifecycle/concurrency tests, root shared registration/048/least-privilege grants.
