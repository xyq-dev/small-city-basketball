# INT01 全分支整合接续

2026-11-06（Asia/Shanghai）；负责人/集成人Codex root。状态IN_PROGRESS / BRANCH_ONLY。

实际现场为`/workspace/scratch/1385f4a4fde1/all-branches-integrate`、`integrate/all-branches-20261106`，从main b19c19a建立。用户明确授权全部分支测试后合并；允许必要Git/隔离CI及修复，不含生产或新外部凭据。根AGENTS及本轮[任务卡](../tasks/INT01-ALL-BRANCHES.md)约束继续有效。

5个远端分支已完整列举：账号安全与COS均是main祖先，只有PR42/UI005和PR44/UI006存在未合入提交。UI005来源133ba3c的Linux微信1207通过/1平台跳过，UI006来源6fc0698为1255通过/1平台跳过，均0失败；不把它们视为最终整合验收。

当前在整合worktree合并UI006，192处冲突均已解决，18处JS经独立复核采用UI006，app.wxss采用UI006/main基准。UI006替代旧DOM和样式，UI005独特业务修复/证据/工具应保留。UI006审查发现预览态仍能导航进入正常业务，独立Agent在自己的worktree修复，root统一纳入；不改真实认证/权限或全局覆写wx。

下一条操作：核验工作区与来源SHA，保留全部已整合改动，取得两位审查者最后修复（记分弹窗、异步账号隔离与旧断言迁移），纳入UI005额外状态矩阵；验证微信测试与相关布局后，将全部来源head作为整合提交祖先共享至新PR，运行完整隔离CI，只有精确候选全通过后合并main。保留所有旧worktree和已有未提交产物。

本轮尚未改后端/数据库；无新增Migration，也未执行生产Migration、部署、真实COS或地图联调。最终Git SHA、测试/CI和main事实在实际完成后收口，不能提前标记DONE。

最新检查点：root整合微信1287通过/1平台skip、全仓格式/类型通过；已纳入预览/两处async/预约筛选修复。7页窄屏触控CSS已纳入，matrix Agent独占spec，子Agent分开迁移97个旧夹具；最终矩阵、证据守卫和精确CI仍待执行。先共享普通分支检查点，待矩阵稳定后创建PR，避免在同一PR反复取消重型CI。
