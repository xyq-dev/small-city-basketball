# COMPLETION22：22项功能实现与测试总任务

2026-10-31 Asia/Shanghai；集成人Codex root；IN_PROGRESS／BRANCH_ONLY。

## 范围与持续执行约束

本任务来自用户逐项列出的22项开发要求：先写真实可运行代码再测试。**总范围始终是下表全部22项，完成第一批或任一切片不等于本任务完成。** 依赖顺序仅用于安排实施；每个切片结束必须逐项回看本表，更新证据并继续下一项可执行工作。只有全部完成，或没有任何可安全继续的独立工作时才结束执行；不能把未实现项改称未来计划后收尾。

基线远端main `dff0a8db6c4673f54a28a381c6ca7849beec6ebd`；tree `c7b92af92d147643585008679960e90059347308`。独立整合目录 `/workspace/scratch/afa947228706/scb-completion22`，分支 `feat/commercial-completion-22`，开工干净；原checkout及所有旧worktree保留。已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION和相关合同。用户此前授权本项目开发、测试、GitHub同步、PR及审查后合并继续有效；禁止生产部署／生产Migration／生产数据、新外部凭据、付费资源和force覆盖。

本轮22项不自动包含DOC005新直播实现，也不重做已合并C23。地图与邮件等外部能力缺凭据时，先完成真实内部流程、受控adapter和隔离测试，真实接入／准入／真机单列，不伪造成功；不能让一个外部阻塞掩盖其他可执行功能。代码、测试、分支／main和线上状态分别记录。

## 固定清单与分工

状态只按实际代码和证据推进：TODO／DESIGN／IMPLEMENTING／TESTING／REVIEW／DONE／BLOCKED。当前DESIGN只是已认领和规则设计，不代表代码完成；代码整合、测试和GitHub证据在每项后续检查点补充。

| ID | 用户功能 | 当前状态 | 负责人／恢复卡 | 必须交付的验收边界 |
| --- | --- | --- | --- | --- |
| F01 | 季军赛 | IMPLEMENTING | competition／X01 | 半决赛负者、第三名、8队16场、独立确认与更正失效 |
| F02 | 更多赛制与异常处理 | IMPLEMENTING | competition＋scheduling／X01、X03 | 双循环、弃权／取消独立裁定、排名与晋级联动，不伪造个人统计 |
| F03 | 排程优化 | IMPLEMENTING | scheduling／X03 | 有界全局优化、首末场均衡、淘汰轮次已知对阵自动排时、硬冲突复检 |
| F04 | 办赛向导与模板 | IMPLEMENTING | scheduling／X03 | 模板保存／版本／实例化、配置到发布的真实阻塞引导 |
| F05 | 公开报名招募 | IMPLEMENTING | recruitment／X05 | 正式赛程前独立招募、申请／独立审核／撤销与公开白名单 |
| F06 | 批量录入与报名邀请 | IMPLEMENTING | recruitment／X05 | 导入预览逐行错误、幂等提交、本届邀请、接受不授机构权限 |
| F07 | 宣传海报 | IMPLEMENTING | recruitment／X05 | 四类真实来源海报及PNG导出、照片许可版本与每次下载复检 |
| F08 | 专业技术统计 | IMPLEMENTING | statistics／X08 | 投篮／命中率、篮板助攻抢断盖帽失误，采集模式和旧赛兼容 |
| F09 | 阵容与上场时间 | IMPLEMENTING | statistics／X08 | 首发／换人／权威时钟区间／实际上场时间及报表 |
| F10 | 可靠离线记分 | IMPLEMENTING | statistics／X08 | 持久原命令队列、同账号租约fence、顺序同步、冲突拒绝与恢复 |
| F11 | 公开长期档案 | IMPLEMENTING | statistics／X08 | 独立发布授权、公共球队球员页、跨届有效榜单、身份关联不按同名 |
| F12 | 全国版界面 | IMPLEMENTING | local／X12 | 五导航、全国首页、旧视频／赛事／预约入口保留与移动布局 |
| F13 | GPS与附近发现 | IMPLEMENTING | local／X12 | 按需定位、手选回退、受控地图adapter、真实距离与地点导航 |
| F14 | 球场预约 | IMPLEMENTING | local／X12 | 经营方审核、时隙／库存原子锁位、过期释放、核销、天气取消 |
| F15 | 同城人员服务 | IMPLEMENTING | local／X12 | 资质人工审核、覆盖／档期、接单到场交付、改期及争议 |
| F16 | 球队约赛 | IMPLEMENTING | local／X12 | 双方队长确认、真实地点／时段、球队与场地冲突 |
| F17 | 工作人员配置界面 | DESIGN | root／X17 | 机构成员／角色、赛事工作人员、现有授权API的真实消费者 |
| F18 | 客服与治理 | IMPLEMENTING | governance／X18 | 工单分派／回复／申诉／举报、真实参与评价与访问隔离 |
| F19 | 城市运营后台 | IMPLEMENTING | governance／X18 | 城市＋机构＋操作范围、供给质量与下架，不跨机构越权 |
| F20 | 广告与赞助 | IMPLEMENTING | governance／X18 | 城市／赛事／时段审批投放、撤销、真实曝光去重统计 |
| F21 | 经费公示 | IMPLEMENTING | governance／X18 | 线下账务追加更正、审批／授权公示，不做钱包或募款 |
| F22 | 账号自助服务 | DESIGN | root／X22 | 邮箱验证与找回、短期单次token、枚举防护、会话撤销、真实投递adapter |

## 所有权、共享接线与迁移号

各agent仅在独立worktree写已分配路径与自己的任务／交接，root独占汇总、共享app.ts/service.ts、contracts/index.*、全局路由及allowlist、基础设施和跨模块消费者接线。发现冲突先协调，不互相覆盖。模板使用既有球员、赛事和冻结资源，不复制第二套身份或比分权威。

迁移预留025 competition、026 scheduling/templates、027 recruitment/posters、028 statistics/lineups、029 local、030 governance、031 root identity、032 public profiles。旧001—024不得改；若某文件仍未完成，不把迁移链和整套测试冒称完整通过。新表精确权限、readiness、重启与非空备份恢复由root整合验收。

## 检查点0：认领与设计

root已认领总任务并分配六个独立实现域；先冻结最小规则／数据／API与旧合同兼容，再按可验证切片编码。季军赛保留默认旧hash，决赛轮分冠军／季军来源；已发布子轮阻止父赛直接重开。双循环与排时owner负责配对，异常裁定另有来源语义，不能造假scoring确认。各agent首次尚未交付代码，尚无本轮新增测试结果。

每一可验证代码切片连同自己的任务／交接提交，root整合并同步GitHub后继续；活跃工作最迟15分钟记录实质检查点。每次记录：精确commit/tree、变更范围、实际验证、未验证、下一项动作；停止采样后不会无人值守更新。本表22个F编号不得因上下文压缩或一次CI通过而遗漏。

下一条操作：完成root账号恢复／工作人员UI的规则设计，批准已审agent合同，整合首个切片，补共享类型和权限／恢复清单；开始有意义的本地测试和精确隔离CI。逐项验收后仍继续本表其他项，不在F01完成时关闭总任务。

## 检查点1：首个兼容性代码切片

已整合X03 a3a10da：排赛policy仅显式thirdPlaceMatch=true保留字段，false／省略维持旧规范化形状和hash，root补共享可选类型。作者已执行API50文件670单测、定向格式和空白检查通过；这是兼容性切片，不代表季军赛／优化器／本22项完成，新增PG／整体验收未执行。root本地整合提交及远端树以对应Git历史为准。

F01／F03开始编码；其他域已确认最小合同并按分工推进。接续操作：完成首个代码和文档GitHub同步后，X03继续优化器／双循环／模板，其他agent继续各自切片；root继续X17／X22及共享接线。剩余22项范围不变。

## 检查点2：季军赛及三域内核已整合，真实PG待验

已整合X01 7305896（root958f56e），含季军树／真实负者proof／025／原生晋级页与3个PG场景；作者定向117、完整API706、原生17通过，PG3项未执行。已整合X05 7b10940：027六表与招募领域10项通过；X12 4979b44：029七表／双向日历占用草案、定位adapter和领域9项通过；X18 63a7f98：030十二表／治理领域8项通过。后三域持久服务及消费者仍未完成。

root整合后的全项目typecheck已通过，API全量单测正在执行，不能预先记成功。025／027／029／030仅编写，尚未运行真实PG；026、028、031、032、033仍待对应owner交付，迁移链和readiness／恢复清单还未整合，不触发不完整schema的生产操作。功能完成仍以F01—F22逐项验收为准。下一条操作：同步此代码检查点后各域继续服务／消费者；root完成X17／X22与共享接线、真实PG／恢复验收，再继续未完成项。
