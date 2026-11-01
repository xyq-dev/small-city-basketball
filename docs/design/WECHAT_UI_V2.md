# 小城市篮球 微信小程序 UI v2 交付

UI001；设计初稿交付，前端实现/正式接入/真机/上线分别验收。更新时间：2026-11-01T02:42:57.537Z。

- [Figma可编辑设计稿与最新封面](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=48-7)
- [全国首页可点击原型](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=4-16&starting-point-node-id=4-16&scaling=scale-down&content-scaling=fixed)
- [完整200张画板、角色、状态与68条路由索引](UI001_SCREEN_INDEX.md)
- [本任务](../tasks/UI001.md) · [接续与检查记录](../handoffs/UI001.md)

## 1. 基线与本轮范围

工作目录 /workspace/scratch/0f4f16dde23c，无本地 Git checkout；没有可报告的本地分支/HEAD/dirty。通过GitHub读取main，开工基线 c61ab3667c9d3f756244a28046b9ee2395ccac00。根AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、全国/本地需求、UI_SPEC、商业与EXPANSION8用法、交付范围及验收、design相关规范已核对；实际app.json仍68条路由。

原127张核心稿基于ebc391e8bd0ec24c3301f64d6ae2f395245701cb。与c61ab36比较只有19份Markdown变化，业务实现相同。本轮保留这些画板和旧D01文件，新增73张DOC006补充设计（62业务/状态、11适配），合计200。说明板、组件、路由不是同一计数口径。

本次只创建/编辑Figma原生设计与Markdown交接；没有业务代码、API合同、数据库、权限、依赖、测试、Migration、pack、部署、生产或付费资源变更。此卡的文档同步由本次Codex作为UI文档集成人执行，不接管并行功能任务。

## 2. 视觉与组件

品牌沿用最新UI_SPEC：深蓝 #123C73、橙 #F28C28、浅底 #F4F6FA、正文 #18283F；中文Noto Sans SC，数字Inter。4/8/12/16/24/32间距；主要触控至少44px；390主尺寸，关键布局另有320/430；直播横屏844×390；本轮后台1440主稿并检查1024。正文及表单值16px；辅助说明与标签有独立层级。

复用文件内13组组件、44变体、46变量、9文字样式：按钮、字段、状态标签、通知、页签、列表行、五导航、头像、比赛卡、步骤、对话框、加载、勾选。原生文本、矢量和组件实例可编辑；Auto Layout承载关联内容和文字换行，长内容纵向滚动，操作区留底部安全区。图片预览不充当设计源文件。

## 3. 功能—页面—角色—交互状态

| 模块 | 画板范围 | 角色及入口 | 必须分开的事实 |
| --- | --- | --- | --- |
| 全国发现/城市/搜索/消息 | H01—H07、E01；适配及X状态 | 五导航，观众优先 | 全国浏览/选择城市/定位/微信通知授权 |
| 赛事/赛程/积分/淘汰/实况 | E02—E09 | 公开内容与有权工作人员统计分开 | 开始/待确认/正式/撤回；视频故障仍保留比分 |
| 球队/成员/档案/球员邀约 | T01—T18、O13 | 球队、领队、本人 | 长期关系/本届名单；公开许可/私有资料；意向/承接/履约 |
| 本人报名/照片/保险/监护 | R01—R12 | 本人、领队、有权审核员 | 提交/付款/出单/保障有效/资格通过/监护核验 |
| 同城球场/人员/约赛/争议 | L01—L08、A06/A07 | 当地真实供给及原订单 | 地点/可售档期；提交/接单/履约/争议 |
| 办赛/招募/审核/排赛/改期 | O01—O13 | 有权主办方工作台 | 草稿/发布/锁定/冲突/独立审核 |
| 记分/换人/专业统计/离线 | S01—S08 | 分配到本场的工作人员 | 本地待同步/服务器已接受/冲突/独立赛果确认 |
| 开播/录像/媒体/回放 | V01—V10 | 有权主播与独立批准人 | 预览/云入流/外站状态/停止证据/录像产物/公开许可 |
| 支付/退款/保证金/结算 | F01—F07 | 原付款人及有权独立管理者 | 原渠道确认/未知/冻结/回退；不伪造钱包 |
| 账号/客服/城市运营/赞助/公示 | A01—A11 | 我的、限权工作台 | 可见城市/所属机构；私有证据/公开公示 |
| 保险供应商条件流程 | IN01—IN08、OP01 | 本人/授权保险运营 | 当前关闭；获批后跳转或获准提交；原付款与保单双状态；日级日期 |
| 地图搜索此区域 | MP01—MP08 | 同城；不需先同意定位 | 已拖未搜/搜中再拖/已搜/空/超范围/跨城确认/地图失败 |
| 全国撮合 | NM01—NM07 | 同城及球队；工作人员/成人球员/球队约赛 | 资格硬过滤；未知费用不当0；意向不锁位、不自动成单 |
| 跨城派单 | DS01—DS12、OP02 | 本人邀请及限权调度 | 报价/客户确认/原预约待确认/服务方承接/付款核对/履约 |
| 培训 | TR01—TR15、OP03/OP04 | 同城课程、有效监护人、当班教练、机构教务 | 锁位/付款/名额；候补不等报名；签到/消费；晚付款原款独立退费 |
| 广告收入分成 | AD01—AD08 | 机构财务后台；手机仅己方报表/独立审批 | 合同/实收/履约/预览/审核/逐方分账；退款与回退独立 |

现有E07是私有工作人员报表。公开档案已有授权统计，不据此把完整私有比赛技术表直接公开；新增公开比赛统计页需API白名单和授权审查。

网页后台专属的供应商核对、调度批次、排课招生、广告合同和财务配置单列设计。普通用户首页不放管理配置；工作人员按实际资源权限进入。“我的”看到角色不代表获得全部机构或全国权限。

## 4. 实际原型与预览

原型是可点击的预设状态，不调用真实支付、保险、通知、摄像、记分或直播。地图移动以点击切换预设视野模拟，未实现自由拖动/地图SDK；表单为布局与状态展示，未模拟输入校验、筛选或数据库写入。跨角色步骤明确标角色，只用于审阅，不代表越权切换已获许可。

| 流程 | 原型 | 正常与关键失败分支 |
| --- | --- | --- |
| 找赛事→报名→本人资料/外部保单→审核 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=4-126&starting-point-node-id=4-126&scaling=scale-down&content-scaling=fixed) | 提交、资格预审、保单、监护与审核独立 |
| 办赛→招募审核→排赛→记分→确认→公开 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=6-951&starting-point-node-id=6-951&scaling=scale-down&content-scaling=fixed) | 分角色推进；离线、冲突与独立确认 |
| 找同城服务→预约→订单→履约 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=4-206&starting-point-node-id=4-206&scaling=scale-down&content-scaling=fixed) | 本地空供给、未接单、争议 |
| 选择比赛→开播准备→控制→录像媒体 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=8-1332&starting-point-node-id=8-1332&scaling=scale-down&content-scaling=fixed) | 未开通、停止未知、授权撤回 |
| 保险主体/条款→资料→办理→原单核对 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=40-1032&starting-point-node-id=40-1032&scaling=scale-down&content-scaling=fixed) | 当前关闭；条件正常/拒保/退保/未成年人关闭 |
| 地图移动→搜索→服务 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=40-1288&starting-point-node-id=40-1288&scaling=scale-down&content-scaling=fixed) | 再拖丢旧响应、空、范围过大、跨城、失败 |
| 需求→范围审阅→候选→意向→原预约 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=42-1112&starting-point-node-id=42-1112&scaling=scale-down&content-scaling=fixed) | 无候选/资格档期变化/报价未知 |
| 跨城邀约→报价→原预约→承接→付款→履约 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=42-1340&starting-point-node-id=42-1340&scaling=scale-down&content-scaling=fixed) | 无人、另人承接、锁过期、付款未知 |
| 课程→资料→锁位→付款核对→课表 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=43-1212&starting-point-node-id=43-1212&scaling=scale-down&content-scaling=fixed) | 候补、晚付款未获名额、专用监护、退款/争议 |
| 广告协议→实收→预览→独立审批→分账 | [打开](https://www.figma.com/proto/BSQ64CrDTJ2P4tOIowOSFk?page-id=2%3A3&node-id=44-1277&starting-point-node-id=44-1277&scaling=scale-down&content-scaling=fixed) | 缺签/无实收/不守恒、部分失败、回退不足/退款独立 |

[首页及五导航预览](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-15) · [保险](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1031) · [地图](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1287) · [撮合](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1111) · [跨城](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1339) · [培训](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1211) · [机构及财务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1276) · [角色移动端](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1617) · [320/430](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1741) · [后台1024](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2050) · [独立复核补充](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1790)。

## 5. 与代码的差异

| 类型 | 当前事实 | 实施影响 |
| --- | --- | --- |
| 样式与信息层级 | 五导航、原68路由及主要业务能力已有源码 | 可先按token/组件调整原WXML/WXSS；保持合同与权限 |
| 交互重组 | 独立预检页、多步骤原型、固定操作区、状态通知与部分工作台拆分 | 前端需新增显示状态/路由或组件，不必假设需要新后端；逐项核对现有API |
| 正式接入待验X | 保险编排、支付/退款/分账、直播媒体、微信通知、定位/地图等已有代码 | 正式账户、供应商、商户和真机另验；真实保险adapter未接且购买默认关闭 |
| DOC006全部P | 保险真实供应商、地图viewport、全国撮合、跨城派单、培训及广告分成 | 均需业务实现，不因画好UI而开放；复用既有能力而非重写 |
| 已核实具体契约缺口 | local查询无viewport；撮合/派单/培训领域未新增；trade来源无培训/广告；赞助曝光不等广告收入 | 按专项任务增加合同/API/后端支持，由功能任务拥有者实现；本次未修改共享契约 |
| 保险与未成年人 | 当前保险合同按日，不表达精确小时；首版在线未成年人扩展未验 | 稿保留日级；未成年人在线投保关闭，赛事监护不能当投保授权 |

培训用途授权与赛事、保险分开；付款人不自动成为监护人。候选必须满足资格硬条件；未知交通费不记0。客户确认报价只创建待服务方确认的预约；承接、付款及履约独立。晚付款未获名额保持消费0和原款960，不套已上课的部分退费。广告退款渠道结果与追回金额不能相互推断，获批垫付另有权限与协议约束。

## 6. 检查证据与限制

- 实际Figma全稿统计：200画板、3391文本、908组件实例、765个NAVIGATE、17起点，界面IMAGE填充0；目标不存在0。图层可编辑不是整图。
- 新增73张结构检查：字体缺失、横向越界、主要动作小于44px、按钮文字高度溢出为0；320/430、后台1440/1024的代表页有专门画板。
- 原四条与新增正常/失败共19条关键路径逐段读取实际reactions核对，缺边0；DS09锁过期另支指向DS06，另人承接指向DS07。
- 旧21组和新增10组按分组截图审阅；修正按钮宽度、徽标、后台页高、培训候补/退款和独立授权、跨城最终确认等。独立只读审查意见已修；未把审查聊天当真实外部测试。
- 通用加载、空、失败、无权限、未登录、未开通、处理中、未知和冲突复用X01—X12；没有为200页复制所有状态的组合。正常与六模块关键失败可点击；同页筛选、输入与实际动作未全面模拟，IN08原单查询为同页状态未模拟返回。
- 未在Figma演示浏览器逐条回放，未执行官方微信开发者工具、真机、读屏/键盘实测、真实通知/支付/保险/直播或生产验收；本次未重跑应用CI，不引用历史CI数字冒充本轮测试。

所有队名、姓名、地点、金额、保单与订单均为合成示例，不包含真实证件、联系方式或外部凭据。未覆盖供应商专有条款/正式销售模式、真实商户能力、实际地图控件与各设备摄像行为，因正式条件未核验；这些是实现/接入待办，不宣称已交付。

## 7. 下一步前端实施顺序

1. Codex UI负责人先实施token、组件、五导航、长名称与安全区，独立任务分支，只改分配UI路径；每切片更新自己的任务/交接。
2. 全国发现、赛事详情、本人报名/照片/外部保单/监护与审核，使用现有真实API；先保留当前在线保险关闭态。
3. 办赛、排赛、记分离线冲突、独立确认与公开观赛；随后直播/媒体角色台，正式外部仍按能力开关。
4. 同城预约及交易状态；地图“搜索此区域”先由功能任务补viewport契约后接UI。撮合与派单共享日历/锁的契约由功能负责人先整合。
5. 培训与广告按各自新交易来源/授权/资金任务接入；保险供应商选型并行，获批后才实现对应跳转或提交。

UI与功能AI各自分支、各改自己的任务卡/交接；共享API和数据合同由功能负责人单写。main汇总由当轮集成人串行更新，遇并发先重读整合，禁止force覆盖。单靠更新文档不能保证代码零冲突，路径分工和合并审查仍需执行。
