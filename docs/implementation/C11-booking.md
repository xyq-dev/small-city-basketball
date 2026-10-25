# C11 创建预约与我的预约按确认稿实现

2026-10-25 Asia/Shanghai；负责人 `/root/c11_booking`；REVIEW / LOCAL_ONLY。工作树 `/workspace/scratch/608836f8d204/c11-booking-ui`，分支 `feat/c11-booking-ui`，起点 `fad0225ee15c049ed14d790f233469a6379bd48e`，开工clean；远端 `xyq-dev/small-city-basketball`。只改分配的两页、独立fixture/直接测试及本文。经root明确批准cherry-pick共享提交767f4eb，本地对应16d3f56；不是本域重新生成共享素材。没有push/merge、生产/数据库/Migration、依赖或外部服务变更。

## 唯一目标与页面

已看 `docs/design/C11/approved-six-screen.png` 及两份390×844工程crop。仅以该用户确认稿为目标，采用12px局部gutter（已获root同意）、80px共享自定义头、五个等宽短模式标签、白卡/细分隔、橙色报价/主操作和原生图片位。没有把整张UI图当运行背景。

- `booking-create`：单场默认是已选球员strip、6行安排摘要、独立费用卡、支付边界提示、橙色核费操作。每个摘要行都是至少44px的真实按钮，打开原完整编辑器；原赛事/球队/多人选择、正式赛程、逐场参与、条件意向、周期、跨日时间、费用复核及声明仍可达。点击“返回预约摘要”只切显示，不声称保存服务器、不清草稿。新字段`editorOpen`与既有`detailsOpen`共同保持编辑挂载，填写最初缺失字段时不突然折叠。
- `bookings`：发出/收到视角在顶部真实按钮分段；每项逐场卡保留总单赛事/球队身份、球员、开始/地点和真实状态。请求中显示原报价；其他完整时间、费用、总单、条件/实收可点•••展开；筛选、10种状态和刷新入口仍可达。列表为空/读取失败/身份变化继续显示原分支，不造订单或付款。
- 共享头/图标由root提供，两页JSON使用`navigationStyle: custom`；实际系统状态栏/微信胶囊归目标环境，兼容预览不是官方微信截图。

## 数据与交互边界

- 没改API、booking SDK、报价/原编号恢复或授权契约。追加字段均为显示数据：月份/跨日时间、去掉`.00`的货币（保留真实分）、已有公开profile的身高地区。报价和payload仍来自原函数。
- 真实DTO无头像；运行`renderForm`不映射示例portrait，订单也不按姓名/ID分配脸。没有资料时用中性SVG占位。示例图片只由合成fixture显式注入`portrait`；合成赛事名称可见标识，未植入产品初始数据。
- 编辑/摘要切换使用原`editable()`，busy、pending、损坏/不可读恢复、review和身份revision变化不能绕过。原默认为未勾的同意仍未勾。`toggleInfo`只可展开当前live读到的订单项，加载/身份失效时拒绝旧操作，onHide清除私有列表和展开项。

## 实际验证

- 新增6项直接VM/WXML回归：摘要/完整编辑草稿与连续输入、初始缺字段编辑持续挂载、写锁/原编号/身份护栏、分与条件费用/跨日显示、当前订单认证展开/隐藏清理、4份fixture三宽真实模板与原生控件及素材来源。
- `node --test apps/wechat/test/c11-booking-ui.test.cjs apps/wechat/test/booking-create.test.cjs apps/wechat/test/booking-orders.test.cjs apps/wechat/test/c09-compare-create.test.cjs apps/wechat/test/native-structure.test.cjs`：92/92通过。
- 全原生运行280项：277通过、3个旧视觉契约预期失配，未改或弱化旧检查。2项`c10-core-state-consistency`对整个旧fixture data做深比较，新`editorOpen/compactQuote`、玩家元信息/slot日期显示字段需由root重新生成原真实空态fixture；1项`c10-fulfill`假定所有履约fixture assets.length=0，与新共享头图标/头像占位矛盾，需按批准稿迁移为禁止整页UI截图并允许明确局部素材。原C09 party summary断言通过，没有把编辑持续挂载回归归咎于旧检查。
- 4份新fixture共12次320/390/430实际模板构建通过；JS语法、所属JS/CJS/JSON Prettier、`git diff --check`通过。
- 尚未实际运行Chromium几何/截图或官方微信/真机；不能以HTML生成或逻辑测试描述一比一完成。交root整合后按确认稿实际截屏比对。

## 新图场景与接续

`c11-booking-create-ready`、`c11-booking-orders-ready`各为本域`visualPrimary:true`，避免与旧catalog的`primary`冲突。`c11-booking-create-editor`保留完整编辑屏；`c11-booking-orders-expanded`保留完整真实费用/报到/总单明细。均标`figmaNode: approved:C11`和参考图路径；该标识是本轮确认图来源，不冒充Figma node。

root下一步：cherry-pick本域提交，仅迁移3个已明确的旧测试/fixture契约；加入6屏实际图片/几何检查，查看三宽字号、按钮、卡片和底部。若需要视觉尺寸微调，仅在本域修正，不扩大后端或补假照片。
