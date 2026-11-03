# Figma V4 10–14组构建与视觉审阅

文件：QpKOskViUwHFVqSG3uYR9X
会话：ceae2350-38f3-4985-a696-9c2c84480f99
范围：仅页面2:11—2:15，共30条路由；未修改主组件、变量、其他页、原型reactions或共享state。

## 结果

30张390×844可编辑语义画板，929个文本、560个组件实例、26个独立图片素材节点。所有文字字体Noto Sans SC；横向文字越界0。图片只用于球场照片、主视觉照片或立体图标，未放入整屏截图。每组Screen row=1234×902，primary FIXED、counter AUTO；总板1282×1976。

五组各完成一次完整构图截图审阅；10/13/14在针对性修正后另完成一次复核截图。11/12无视觉问题，不重复截图。浅蓝Notice均正常，没有黑底。长页面内容在固定viewport内纵向滚动，截图首屏截断属于视口，不是内容删除。未在Figma演示浏览器实测滚动、输入、真实动作或真机。

## 修正

- scorer六个加分按钮从单列改为双方双列三行；离线提示前置；时钟、换人、节次保持待联网禁用。
- scorer及poster的比分冒号与分数使用同Display字号/行高并顶对齐，修复冒号下沉。
- messages移除重复的“提醒设置”入口，保留单一橙色主动作；删除链接节点20:5100。
- platform的服务资料审核、城市授权管理、评价处理分别记录到platform-review、city-operations-platform、governance-reviews-platform，等待root接线。
- account-recovery返回登录记录到account-guest，避免误入已登录个人主页。

## 画板与路由

| 组 | 画板 | 路由 | 页面节点 |
|---|---|---|---|
| 10 | 20:4447 | scoring-tasks | 20:4454 |
| 10 | 20:4447 | scorer | 20:4541 |
| 10 | 20:4447 | match-exceptions | 20:4644 |
| 10 | 20:4447 | live-studio | 20:4733 |
| 10 | 20:4447 | media-jobs | 20:4845 |
| 10 | 20:4447 | match-media | 20:4948 |
| 11 | 20:3851 | local-manage | 20:3858 |
| 11 | 20:3851 | local-bookings | 20:3954 |
| 11 | 20:3851 | local-matchups | 20:4055 |
| 11 | 20:3851 | matching | 20:4137 |
| 11 | 20:3851 | dispatch | 20:4240 |
| 11 | 20:3851 | training | 20:4348 |
| 12 | 20:6125 | training-manage | 20:6132 |
| 12 | 20:6125 | trade-order | 20:6229 |
| 12 | 20:6125 | trade-manage | 20:6323 |
| 12 | 20:6125 | insurance | 20:6428 |
| 12 | 20:6125 | guardian | 20:6533 |
| 12 | 20:6125 | youth-review | 20:6612 |
| 13 | 20:5034 | messages | 20:5041 |
| 13 | 20:5034 | notification-settings | 20:5137 |
| 13 | 20:5034 | account-recovery | 20:5210 |
| 13 | 20:5034 | account-closure | 20:5288 |
| 13 | 20:5034 | governance | 20:5387 |
| 13 | 20:5034 | governance-reviews | 20:5474 |
| 14 | 20:5541 | city-operations | 20:5548 |
| 14 | 20:5541 | sponsorships | 20:5643 |
| 14 | 20:5541 | sponsor-commerce | 20:5728 |
| 14 | 20:5541 | poster | 20:5818 |
| 14 | 20:5541 | platform | 20:5904 |
| 14 | 20:5541 | planned | 20:6021 |

各组全部节点、screens、links及结构诊断见build-10-final.json—build-14-final.json。所有链接目前只是本地交接数据，本任务未写Figma原型连接。仅构图和静态结构验收，不代表业务接口、权限、支付、保险、直播或生产通过。
