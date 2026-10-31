# COMPLETION22恢复入口

2026-10-31 Asia/Shanghai；Codex root；IN_PROGRESS／BRANCH_ONLY。这是用户明确要求的22项实现总任务，不是只做季军赛的单卡。

第一条操作：核验远端／分支／HEAD／dirty，读取[总任务](../tasks/COMPLETION22.md)全部F01—F22和本文末最新检查点，再恢复已在执行的切片；不要重置旧worktree或在没有新证据时重跑已通过的同源码测试。

基线main dff0a8d，整合目录/workspace/scratch/afa947228706/scb-completion22，分支feat/commercial-completion-22。六域独立worktree为scb-x01、x03、x05、x08、x12、x18；root负责共享接线、X17工作人员UI及X22账号自助、基础设施和主文档。迁移号和所有权以总任务为准。

当前检查点0：设计认领已完成，首轮合同审查中，尚无新增实现或测试可记通过。各agent每切片commit并更新其任务／交接，root负责同步GitHub；15分钟活跃检查点继续有效。后续每完成一个切片，必须回看22项总范围、继续下一项可执行工作；只有全完或不存在可安全推进的独立工作才结束。本任务不会因F01或第一批CI成功自动完成。

权限为本地开发／测试、普通GitHub同步、隔离Migration及审查后合并；禁止生产、真实凭据、付费资源、强制覆盖。GPS与邮件等外部接入未核验时要如实单列，不伪造定位或邮件投递，也不能因此停止其他内部功能。DOC005仅直播设计，不自动混入本轮22项。
