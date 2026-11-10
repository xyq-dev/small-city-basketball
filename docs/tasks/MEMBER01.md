# MEMBER01 · 会员商业规则、定价与现有按届权益完善

2026-11-10 Asia/Shanghai；root 唯一集成人；IN_PROGRESS / LOCAL_ONLY。

现场：`/workspace/scratch/dc6a786e1a31/scb-tmx`，origin `https://github.com/xyq-dev/small-city-basketball.git`；基线及远端 main 均 `770534bf449aacf229dd072c5e985b9a9b1547aa`，开工干净。分支 `feat/MEMBER01-membership-foundation`。未发现本任务已有开发/测试进程，保留所有历史 checkout/worktree。

用户要求参照小球迷助手，定制本项目会员功能和价格，并完善会员系统。本轮先交付有证据的竞品研究、完整会员商业规则与视觉提案；普通球迷免费，机构采购软件权益。按既有 UI 流程，新会员中心先展示效果图，确认视觉后再整理 Figma 与实现。月/年跨届会员尚无数据模型，不能将按届激活期限冒称订阅。

可独立落地的现有功能切片：平台三档按届定价模板（仅填表，明确确认后仍走既有套餐版本发布）；服务端数据库时钟投影 READY/EXPIRED/ACTIVATED/REVOKED/REFUND_PENDING/UNAVAILABLE 和核对时间；前端状态校验与旧 API 中性降级。保留原付款、双人审核、权限、首次发布激活、退款、比分与计时逻辑。买会员不授管理权。

允许路径：commerce contract、commerce service 及新的状态纯函数/直接测试、原 commerce PG 集成、admin commerce 与 API 解析/直接测试、原 commerce API E2E、原商业恢复比较与直接回归、CI合成截图保存（不改执行/门禁）、本任务设计/交接与 root 汇总文档。作者必须独立 worktree，不同作者不得同时写共享文件。root 负责 contract、API 解析、E2E、设计文档、汇总与整合。

禁止：生产部署/生产 Migration/账号或正式套餐价格修改、收费或新支付凭据、付费资源、公网端口；不修改001–051、依赖/锁/全局 UI/球队成员页面、不复制支付或比赛状态。沿用仓库核验的开发、测试、commit/普通同步/PR/审查后merge权限。

验证：按风险做格式/类型/构建与直接单测；PG、桌面/手机真实API验证沿用隔离CI，不把响应Mock等同真实付款或PG。Migration：本轮无需编写或执行；月/年会员属于下一卡，必须另做数据/并发/恢复设计与真实PG。

下一步：冻结定价与方案文档，完成现有权益展示和按届模板；展示新 UI 提案并等待视觉方向确认。本卡完成不代表月/年会员已可售或生产上线。


## 2026-11-10 15:33 Asia/Shanghai 整合检查点

backend作者b25c081、admin作者b3dea11已精确cherry-pick至root38d3bd1/f0f84fa。root已补兼容旧API的投影字段校验、17项API边界回归、原真实浏览器模板取消/确认/零POST/数据库目录不变与截图保留步骤。没有新付款/激活/退款写逻辑、端点、Migration、依赖或全局视觉变更。

直接admin三文件43/43通过（组件响应为单测Mock）；完整API源码1425/1425由backend作者运行；root完整typecheck/build通过。首次将Vitest工作目录指定在仓库根导致未找到测试，已更正workspace后执行；首次解析整合拒绝REVOKED+activated合成反例，已按撤销优先修正并43/43重验，未放宽READY等一致性校验。旧500kB构建提示保留。真实PG/浏览器/HTTPS与恢复待隔离CI，不以源码代替。

独立只读审查暂未发现新增P1/P2。用户通过request_user_input选择“采用当前方向”，新Figma会员专页原生可编辑整理中，不再次确认。完整业务规则见design/MEMBERSHIP_SYSTEM.md；月/年跨届会员代码仍为MEMBER02 TODO，未新增Migration。本地尚未发布三档真实套餐，生产完全未动。


## 2026-11-10 15:45 Asia/Shanghai CI修复与Figma交付

PR53 source e4efe958、tree913585f与测试merge bb84ed5 tree相同。首轮CI42776355191 account-security成功，production完成HTTPS/浏览器4项及同卷重建后在第二PG恢复比较失败：新增statusCheckedAt每次读取变化，被原commerce facts当持久字段比较。不是随机网络失败，也不是已通过恢复。root仅在原scripts/c05-commerce-check.mjs的entitlements比较剔除此读取时刻，activationStatus、金额/报价、来源、额度、撤销/激活与对账仍精确比较；新增3回归+既有打包1共4通过，12种业务事实改变仍被识别。独立delta审查无P1/P2，同意新head全量CI，不用旧head成功项替代。未修改应用guard/原Migration/Dockerfile/依赖。

完整admin712与API1425由root在冻结e4本地独立执行通过；format/type/build通过。新Figma原生可编辑交付已完成，root独立看过桌面/两手机/状态PNG，见design/MEMBERSHIP_UI.md；4族23变体、13状态。月年代码仍未实现，未可售。下一步同步恢复修复与Figma文档，按新head完整隔离CI；不部署生产。
