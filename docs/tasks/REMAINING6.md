# REMAINING6：六项功能实现

状态：IN_PROGRESS；integration：BRANCH_ONLY（仅开工记录）；日期：2026-11-01 Asia/Shanghai。集成人：当前Codex root。任务来自用户“先开发这些”，业务依据DOC006六份专项。

## 核验与权限

工作目录 `/workspace/scratch/aad368826b09/scb-six`；分支 `feat/remaining-six`；远端 `https://github.com/xyq-dev/small-city-basketball.git`；基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`，tree `99a5483bcd7c51032880deb0e24469b6546b1eda`。新独立checkout开始时clean，未改既有工作树。通过GitHub连接器补齐40个缺失blob，逐SHA核验并恢复exact commit/tree；本地仅保留浅层历史，GitHub同步由集成人按真实远端父提交进行。

允许本任务实现、定向和必要隔离测试、明确路径commit、普通分支同步、PR与审查通过后的整合；禁止生产部署/生产Migration/生产数据、真实资金/投保/消息、付费资源、新外部凭据及公网端口。沿用AGENTS已有Git与隔离CI授权。

## 所有权与依赖

| 子任务 | 独立分支/目录后缀 | 独占模块与迁移 | 当前状态 |
|---|---|---|---|
| R6INS | work/r6-insurance / scb-six-insurance | insurance代码与页面，043准入；真实供应商协议另为外部阻塞 | IN_PROGRESS |
| R6MAP | work/r6-map / scb-six-map | local查询/DTO/原生地图页面；暂不新增迁移 | IN_PROGRESS |
| R6MATCH | work/r6-matching / scb-six-matching | matching新域/API/页面，044 | IN_PROGRESS |
| R6DISPATCH | work/r6-dispatch / scb-six-dispatch | dispatch新域/API/页面，045 | IN_PROGRESS |
| R6TRAIN | work/r6-training / scb-six-training | training新域/API/页面，046 | IN_PROGRESS |
| R6ADS | work/r6-ads / scb-six-ads | sponsor-commerce新域、多方driver/API/页面，047 | IN_PROGRESS |
| 集成 | feat/remaining-six / scb-six | app装配、shared contracts索引、trade来源、共享日历048、源事务转换、菜单/恢复/注销及汇总 | IN_PROGRESS |

子任务只写自己的任务/交接，不写CURRENT_STATUS/TASKS。旧迁移001—042冻结；新增迁移在合并前统一检查连续性。LocalServicesService查询部分先由地图子任务负责，源事务提取由root串行接续，其他任务通过明确同事务hook集成，不绕过原业务。

## 验证与检查点

- 开工已执行API TypeScript检查：`npm run typecheck --workspace @small-city-basketball/api`，退出0。仅证明未修改基线可类型检查。
- 依赖复用同仓库现有安装，不升级锁文件。当前执行器未提供Docker/psql；真实PG与恢复测试拟由隔离CI执行，未运行前不得标通过。
- 计划依次执行每模块有效单测/原生VM、整合typecheck/format/build、真实PG鉴权/并发/资金/日历、页面真实HTTP与布局、迁移重启及恢复隔离。代码审查与当前HEAD证据通过后才整合。
- 保险真实供应商、正式商户能力、培训属地经营条件及微信真机属于外部验收，不能用合成驱动替代。未接能力保持关闭，保留可执行已有订单核对义务。

下一步：各子任务提交第一可验证切片；root建立共享交易源及原子源转换适配，按切片同步分支与文档。
