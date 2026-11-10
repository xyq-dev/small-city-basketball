# MEMBER01 · 会员商业规则、定价与现有按届权益完善

2026-11-10 Asia/Shanghai；root 唯一集成人；IN_PROGRESS / LOCAL_ONLY。

现场：`/workspace/scratch/dc6a786e1a31/scb-tmx`，origin `https://github.com/xyq-dev/small-city-basketball.git`；基线及远端 main 均 `770534bf449aacf229dd072c5e985b9a9b1547aa`，开工干净。分支 `feat/MEMBER01-membership-foundation`。未发现本任务已有开发/测试进程，保留所有历史 checkout/worktree。

用户要求参照小球迷助手，定制本项目会员功能和价格，并完善会员系统。本轮先交付有证据的竞品研究、完整会员商业规则与视觉提案；普通球迷免费，机构采购软件权益。按既有 UI 流程，新会员中心先展示效果图，确认视觉后再整理 Figma 与实现。月/年跨届会员尚无数据模型，不能将按届激活期限冒称订阅。

可独立落地的现有功能切片：平台三档按届定价模板（仅填表，明确确认后仍走既有套餐版本发布）；服务端数据库时钟投影 READY/EXPIRED/ACTIVATED/REVOKED/REFUND_PENDING/UNAVAILABLE 和核对时间；前端状态校验与旧 API 中性降级。保留原付款、双人审核、权限、首次发布激活、退款、比分与计时逻辑。买会员不授管理权。

允许路径：commerce contract、commerce service 及新的状态纯函数/直接测试、原 commerce PG 集成、admin commerce 与 API 解析/直接测试、原 commerce API E2E、本任务设计/交接与 root 汇总文档。作者必须独立 worktree，不同作者不得同时写共享文件。root 负责 contract、API 解析、E2E、设计文档、汇总与整合。

禁止：生产部署/生产 Migration/账号或正式套餐价格修改、收费或新支付凭据、付费资源、公网端口；不修改001–051、依赖/锁/全局 UI/球队成员页面、不复制支付或比赛状态。沿用仓库核验的开发、测试、commit/普通同步/PR/审查后merge权限。

验证：按风险做格式/类型/构建与直接单测；PG、桌面/手机真实API验证沿用隔离CI，不把响应Mock等同真实付款或PG。Migration：本轮无需编写或执行；月/年会员属于下一卡，必须另做数据/并发/恢复设计与真实PG。

下一步：冻结定价与方案文档，完成现有权益展示和按届模板；展示新 UI 提案并等待视觉方向确认。本卡完成不代表月/年会员已可售或生产上线。
