# 小程序图标规范（C13）

2026-10-26 Asia/Shanghai。适用于 `apps/wechat` 全部 `scb-icon` 图标。

## 规范

- 风格：简洁、圆角、线性的体育应用图标；24×24画布，线宽2，`stroke-linecap/linejoin: round`，内容保持在约2–22的安全区内，视觉重量一致。
- 色调（仅复用现有配色）：`navy #132c49` 普通内容；`orange #ff6b2d` 选中/强调；`gray #617286` 底部导航未选中；`white #ffffff` 深色背景；`green #16a575` 已审核等成功状态。
- 运行端：每个名称×色调一张透明背景PNG（120×120，24画布的5倍，最大显示40px在pixelRatio 3下不模糊），路径 `assets/approved-ui/icon-<name>-<tone>.png`，经 `scb-icon` 组件按 `name/tone/size` 引用，接口不变。图标仍以 `aspectFit` 显示，不拉伸。
- 矢量源：`tools/wechat-icons/src/<name>.svg`（`currentColor`），由 `node scripts/build-wechat-icons.mjs` 用本地Chromium渲染生成PNG。不依赖远程图片、图标字体或运行时图标库，不在运行端直接显示SVG。
- 来源与许可：全部为本项目自绘，随仓库许可证发布，未引用第三方图标集。
- 禁止用Emoji、Unicode符号或圆点充当功能图标；图标按钮保留文字或 `aria-label`，热区不小于44px。

## 名称映射

| 场景 | 名称 | 图形 |
|---|---|---|
| 底部导航 首页/赛事/视频/我的 | `home` / `trophy` / `play` / `user` | 房屋 / 奖杯 / 播放框 / 人物轮廓；选中orange、未选中gray，全部页面同一套，取消圆点备用 |
| 首页 赛事观赛/我的球队/赛事数据/比赛视频 | `court` / `users` / `chart` / `play` | 篮球场 / 多人 / 柱状统计图（替换奖杯）/ 播放框 |
| 球员位置 控卫/分卫/小前/大前/中锋 | `pos-pg` / `pos-sg` / `pos-sf` / `pos-pf` / `pos-c` | 球衣轮廓＋PG/SG/SF/PF/C 标识，统一navy；中文标签与筛选逻辑不变 |
| 返回/前往/展开收起 | `chevron-left` / `chevron-right` / `chevron-up` / `chevron-down` / `arrow-right` | 线性折角 / 箭头 |
| 搜索/定位/日期/时间 | `search` / `pin` / `calendar` / `clock` | 放大镜 / 定位针 / 日历 / 时钟 |
| 提示/已审核/沟通 | `info` / `shield` / `chat` | 圆形信息 / 盾牌加勾 / 对话气泡 |
| 选择与更多 | `check` / `plus` / `more` | 勾 / 加号 / 三点（替换 `⋯` 字符） |
| 其他 | `basketball` | 篮球 |
