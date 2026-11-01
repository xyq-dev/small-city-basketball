# UI002-SERVICES 同城与新增服务前端整合

状态：IN_PROGRESS / LOCAL_ONLY。负责人：本轮 Codex ui_services；集成人 root。

2026-11-01 Asia/Shanghai；工作目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-services`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，独立分支 `work/ui002-services`，开工 HEAD `c22fde9b82454232082716271d5a09968d3c9616`，初始 clean。

允许路径：11 个分配服务路由（matching、dispatch、training、training-manage、sponsor-commerce、local-manage、local-bookings、local-matchups、booking-create、bookings、booking-detail），本任务/交接、直接相关测试与 `ui002-services-*` 合成布局样本。共享组件、主导航、API与合同由 root 负责；不改权限、资金规则、Migration或生产。

已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI001 交付和屏幕索引、REMAINING6 当前摘要。NM03 `42:1186` 高保真 Figma context 与截图已实际取得，无静态图片资产；将 React 参考适配原生 WXML/WXSS。

首片：撮合在原路由内分需求/收到意向、填写/公开范围审阅、候选/双方意向及原预约条款；保留真实API、原编号恢复、成人和独立权限门槛。尚未验证，不标完成。root 负责按切片串行同步远端。

首片验证：`node --test apps/wechat/test/r6-matching.test.cjs apps/wechat/test/ui002-services.test.cjs` 13/13通过；新增需求公开范围审阅/返回编辑不写API、未决原编号跨页保留、换账号清除审阅同意。WXML真实组件静态渲染、JS语法、定向Prettier和diff检查通过。新增候选/关闭/UNKNOWN三个合成布局样本；320/390/430浏览器、当前HEAD完整CI和微信真机尚未执行。

独立审查修复：matching换账号完整清除私有需求草稿、地址/地区/时段/合同、报价预览/球场选择及收费资格同意，并关闭旧账号capabilities；仅清页面pending引用，旧actor持久原编号不删除。新增VM复现A草稿不能由B重开；定向14/14通过。培训下一片仍在本地实施，不混入此安全修复。

培训片：复用当前两路由，课程列表→班次与合同→本人资料/明确付款授权→锁位状态→原交易，课程与我的报名独立视区；保留真实补课选择、逐课退款和原编号恢复。教练/教务按课表、班期、退费异议、资质排课分工作区，签到与消费分开。追加完整换号草稿清理，未修改业务API与资金状态。

设计依据：TR03 metadata及49:1639付款人字段、49:1642合同金额、43:1313固定操作区高保真context与截图；OP04/OP03 metadata及44:1692教练课表卡、44:1594课程安排卡高保真context与截图。整屏context/截图超时已终止，未冒称取得。设计中青少年/监护流程在当前T1成人实现中明确关闭，未复用赛事授权。后台1440稿转为现有有权移动工作区，未新增后台路由。

验证：`node --test apps/wechat/test/r6-training.test.cjs apps/wechat/test/ui002-services.test.cjs`25/25通过；保留全部原有结课/恢复/UNKNOWN/补课权限与真实命令断言，仅让原渲染测试解析真实全局组件注册。新增6份培训合成布局样本，累计9样本的320/390/430共27份真实WXML/WXSS兼容HTML生成成功；这不代表浏览器几何、微信运行时或真机通过。根集成CI及独立Review仍待。

派单/广告片：dispatch分本人需求、收到邀请、本人接单许可、新需求四区；报价确认采用固定操作区，保持当前quoteHash、独立差旅核验和原预约承接/付款/履约分离。sponsor默认本人合同，订单内部收款交付、分账独立审批、退款追回分区；未知只查原号。root已确认适配差异：AD01–06原为桌面后台稿，既有有权小程序管理消费者保留在显式“管理配置”工作区，不删除功能、不新造后台，普通广告主不显示配置表单；服务端权限仍是唯一授权依据。

设计实际读取：DS04/AD07/L05 metadata，49:1587完整报价卡、44:1630本方对账卡、8:1138同城订单卡均高保真context与截图，图片资产为0。不是200页逐像素验收。

额外安全收尾：5个新增域在页面隐藏期间换账号、再返回时也先清旧私有草稿，不能依赖已经解除订阅的换号监听；清培训旧私有深链ID。原持久命令仍按旧actor隔离，未删历史。修正所有新增按钮文本箭头字符，保留icons既有守卫。

验证：R6 matching10、dispatch7、sponsor6、入口6、training19、UI002服务9、icons5共62项定向通过；新增9个派单/广告合成布局样本，累计18样本×3宽54份真实模板兼容HTML生成及预期文案核对通过，浏览器三宽/微信与正式渠道仍待root/专项验收。无API、数据库、依赖、Migration或生产变更。

独立Review竞态修复：training/training-manage增加独立子视图read代次，返回列表、切工作区、隐藏或换号会取消旧详情/课表/报名响应，A/B乱序只保留最新请求，旧错误也不回填；不粗增catalog的_generation，mineLoading在导航取消时明确结束。matching切新表单、dispatch切工作区、sponsor返回订单通过ui.begin取消旧read，保持hold写锁及原持久命令。

实际延迟Promise VM复现覆盖6项：学员详情→返回/重选A/B、我的列表取消不悬挂、教务课表/报名跨域乱序、撮合选详情→新表单、派单详情→本人许可、广告详情→返回。training19＋UI00215共34/34通过；全部R6/入口/icons合计68项定向通过。未修改后台规则或迁移，浏览器与根完整CI仍另验。

最后6路由收尾（REVIEW / LOCAL_ONLY，尚待root整合与当前候选CI）：同城订单列表和详情分区、角色筛选、原资金单/核销/改期仍接现有API；供给列表与新增/修订申请分区，天气与独立审核提示按L08；约赛列表与邀请分区，双方确认和原场地不变。成熟球员预约三页复用原实现，新增统一步骤、逐场资金单快捷入口和当前可见场次核对，动态支付提示以现有workspace.paymentNotice为准，不写死当前机构永远未开通。仅视觉与消费者接线，不改业务规则。关闭sponsor样本改为显式已读取的enabled:false/空列表响应，不将初始未请求状态冒充已读关闭。

设计实际补读：T09/T17/T18、L07/L08 metadata，以及5:1226报价卡、5:1269预约文案、5:1303逐场摘要、8:1262双方确认通知、8:1320审核公开通知的高保真context与截图；所有新增静态图片为0，原成熟占位图/动态图像保持。并未逐张取得200全屏高保真输出，不标整套逐像素匹配。

| 路由 | 本次落地与原流程接线 | 本域合成样本数 |
| --- | --- | --- |
| matching | 需求/收到意向、公开范围审阅、候选/双方意向/原预约；换号及子读取消 | 3 |
| dispatch | 需求/邀请/本人许可/新需求，完整报价确认固定区，原预约履约继续 | 4 |
| training | 课程/我的、班次合同、成人资料与收费确认、锁位/候补/晚付款无名额、补课退款 | 5 |
| training-manage | 教练课表、班期、退款异议、资质排课工作区，真实签到及独立消费 | 1 |
| sponsor-commerce | 本人合同、订单交付/分账审批/退款追回、己方报表及有权管理配置 | 5 |
| local-bookings | 买方/服务方订单筛选、订单概览/履约改期、原资金单与一次性现场核销 | 2 |
| local-manage | 已有供给列表/明确新申请/修订与独立审核、地图建议与档期 | 2 |
| local-matchups | 当前约赛/发起邀请、双方独立确认与真实球场预约保持 | 1 |
| booking-create | 保留成熟五类预约编辑/报价/原单恢复，接统一步骤导航 | 1 |
| bookings | 保留双向授权与逐场状态筛选，扩展明细可转本场真实资金单 | 1 |
| booking-detail | 保留逐场命令/独立确认/原编号恢复，统一头部与阶段信息；资金跳转复核当前可见场次 | 1 |

直接验证：11路由对应R6/入口/X12/booking-create/booking-orders/C11/UI002/icons共165/165通过，定向Prettier与git diff --check通过；26个本域合成样本覆盖全部11路由，320/390/430共78份真实WXML/WXSS兼容HTML生成及预期出现/缺失文案核对通过。浏览器几何/PNG由root当前候选CI验证；官方微信工具、真机、正式支付保险直播未执行。Migration未编写、未执行，生产未操作。

下一条操作：root串行cherry-pick本片并同步远端后，由独立审查核对delta，再用最终整合候选完成项目必要CI；不得以本地165项替代最终CI或微信/生产验收。工作区只剩本地临时依赖软链接（不提交），无其他协作者未提交改动。

最终整合候选一致性修复（root报告CI164）：实际文件名为`c10-core-booking-empty.json`及`c10-core-booking-permission.json`，不是`booking-create-*`。从真实Page初始data读取bookingSteps，给两份既有完整快照补arrange/安排信息、review/报价与条款、result/原单结果（disabled:true）；其他业务字段和expect保持，deepStrictEqual原断言不变，未删除/过滤新属性。

实际验证命令：`node --test apps/wechat/test/c10-core-state-consistency.test.cjs apps/wechat/test/booking-create.test.cjs apps/wechat/test/booking-orders.test.cjs apps/wechat/test/c11-booking-ui.test.cjs`，68/68通过；两JSON定向Prettier与diff检查通过。仅两fixture与本任务/交接文档，源码、API、资金规则、Migration和生产均未变。交root串行同步并按最终候选CI验收。
