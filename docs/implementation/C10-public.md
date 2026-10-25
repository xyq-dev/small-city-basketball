# C10 · 公开观赛页面视觉还原

2026-10-25 Asia/Shanghai；作者 `/root/c10_public`；分支 `feat/c10-public`，目录 `/workspace/scratch/608836f8d204/c10-public`；起点55d5dd9。四页已实施及本地回归，等待root整合和新浏览器截图。没有微信开发者工具/真机结果。

## 原稿与路由映射

Figma文件 `2jAHpYjdIHqal1nXeoVqm6`。以下所有节点已通过含截图的`get_design_context`读取高保真上下文；不是只凭截图猜样式。原稿截图与完整上下文保存在共享scratch `/workspace/scratch/608836f8d204/c10-public-context/`，root可按此目录汇总报告。

| 原生路由 | 主参考 | 来源性质/主fixture | 原稿截图 |
|---|---|---|---|
| `watch` | S02 `9:58`、X04 `11:54` | derived；授权链接输入入口没有独立整屏原稿，复用同一主题、面板、输入与独立CTA；`c10-public-watch-ready` | `reference-event.png` |
| `media` | S08 `9:421` | derived；独立媒体入口为说明页，没有API目录/示例视频；`c10-public-media-ready` | `reference-media.png` |
| `event` | S02 `9:58` | direct layout；`c10-public-event-ready` | `reference-event.png` |
| `match` | S04 `9:155` | direct layout；`c10-public-match-ready` | `reference-match.png` |

`primary:true`每条路由恰好一份；两个静态入口fixture标`static:true`，不为布局插入不存在的“合成赛事”。

页内状态补读：赛程S03 `9:109`（`reference-schedule.png`）、分组S05 `9:215`（`reference-ranking.png`）、淘汰S06 `9:329`（`reference-bracket.png`）、正式赛果S07 `9:374`（`reference-result.png`）、加载/失败X03 `11:36`、无权X04 `11:54`、公开撤销X13 `11:196`（分别`reference-loading/denied/revoked.png`）。三个通用状态原稿为560px宽状态卡，适配手机卡片；不声称560px状态图与390px整屏逐像素一致。

## 已实施内容及边界

- 赛事概览还原白色描边赛事卡、24px内距/16px信息节奏、状态胶囊、赛制标题、原court插图及独立满宽按钮。原 `tab` 继续控制赛程/排名/媒体；新增纯展示 `overview` 可从概览进入分区并返回，刷新时禁止切换，网络端点和查询不变。日期仅作MM/DD展示；分组资格/淘汰WAITING与BYE作可读标签，不改原记录。
- 赛程还原32px比分卡与时间说明；无比分显示破折号及未准备说明。分组使用球队/胜负/积分表，不生成跨组排名；淘汰仍保留轮空/待晋级/未发布/已完成名次。接口没有直接给出的队数、每组晋级规则不会以原稿示例写死。
- 比赛还原海军蓝比分块（24px内距、12px节奏、56/70比分、22/34计时）、橙色圆点资料列表和分节比分。已独立确认另用白色正式赛果卡；不推导胜者身份或个人统计。比分与服务器收据时间、轮询和媒体读取逻辑未改，原迟到媒体不移动时钟锚点回归保留。
- 公开媒体继续由当前有效API记录决定实际图片、视频、外链和marker。S08图中的球场插图是原稿媒体占位示例，不拿它伪装真实回放；产品运行只使用数据驱动src。合成媒体fixture为离线布局专门提供本地court图，视频src会被兼容helper转为无网络元数据。图片/视频真实播放仍待微信验收。
- 公开入口、赛事和比赛补充实际支持的加载、无已发布数据、失败及撤销状态卡。404仍先清空旧赛事、赛程、签位或比分/媒体，再显示停止公开；普通网络错误保留已有资料但明确标陈旧。未新增公开目录、写请求或账号权限。
- 导航采用已有`scb-nav`；赛事/赛况为Events，比赛媒体为Video。页内API资料不因样式变化转成演示数据。没有后端、Migration、配置凭据、生产或部署修改。

## 合成状态目录

均在`tests/mini-program/fixtures/c10-public-*.json`，每份带`state`、`figmaNode`、`expectText`；共22份。

| 页面 | ready/业务状态 | 加载 | 空数据 | 失败 | 公开权限/撤销 |
|---|---|---|---|---|---|
| watch | watch-ready（static） | 不适用：静态输入页 | 不适用：没有赛事目录 | watch-error（链接校验保留输入） | 不适用：在event读取时检查公开授权 |
| media | media-ready（static） | 不适用：静态入口 | 不适用：实际媒体为空在match页 | 不适用：未发起请求 | 不适用：实际媒体授权在match读取时核验 |
| event | event-ready / event-schedule / event-groups / event-bracket / event-results | event-loading | event-empty（未发布赛程） | event-error / event-stale | event-permission |
| match | match-ready / match-confirmed / match-media | match-loading | match-empty / match-media-empty | match-error / match-stale | match-permission |

## 本地验证及交接

- `node --test apps/wechat/test/*.test.cjs`：238/238通过（基线232+新增6）。包含22份fixture×三宽真实WXML/WXSS模板生成、无实际远程src、静态资产非空检查；这不是浏览器几何验收。
- 新增真实Page检查概览/页签切换仅改展示、刷新锁、显示标签不篡改原公开记录、分组不请求虚构总积分、404清空后才渲染无权态、无效观赛链接保留输入且无隐藏请求；旧服务器时钟和媒体回归继续通过。
- 首次新模板测试一项误把`data-mini-src`元数据匹配成实际`src`网络属性，已将检查限定为空白起始的真实src属性；不放宽浏览器离线/无网络守卫。
- JS/CJS/fixture格式和`git diff --check`通过。没有在本工作树运行Chromium或微信工具；root应整合后在三宽实际浏览器检查标题、表格、底部导航、安全区及court实际比例，再把新原件截图纳入整套报告。原稿court同源PNG已存在且非空，使用`mode=widthFix`保持比例，不新增临时Figma URL。
