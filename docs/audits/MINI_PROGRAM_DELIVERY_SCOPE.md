# 小程序总交付清单（C16 统一版）

2026-10-27 Asia/Shanghai。本清单逐项核对实际代码与验证证据，不代表已合并或上线。

- 分支：`feat/mini-program-delivery`（C16，Draft PR，基于 #24 → #23 → #22 叠加，**均未合并**）；main 与生产均**未更新**。
- 历史口径：C14 首版见提交 `1535890` 中本文件；C15、C16 的变化见文末“变更记录”。

## 状态口径

| 标记 | 含义 |
|---|---|
| **已验证** | 已实现，并有 VM 回归与真实 API 联调（`tests/wechat-api`：真实页面代码在 VM 中运行，请求转发到隔离 PostgreSQL 上的真实 API） |
| **待验证** | 已实现，只有 VM 回归和兼容布局，或依赖服务端配置后才能实测 |
| **缺交互** | 既有 API 可以支持，小程序没有页面或交互 |
| **待审** | 需要新后端（API、数据、公开授权），见 [C16 待审包](../design/C16_PENDING_REVIEW.md) |
| **外部** | 依赖外部资质、凭据、付费服务或真实设备 |
| **规划** | 文档中明确属于未来规划，本期不做 |

**全部条目共同的待验项**：官方微信开发者工具、真机、正式 AppID 合法域名，以及 320/430 官方截图，均未验收（截图按要求暂缓）。“兼容布局”指本地 Chromium 渲染真实 WXML/WXSS，不是微信运行时。

证据代号：

| 代号 | 文件 |
|---|---|
| VM | `apps/wechat/test/*.test.cjs` |
| API-E | `tests/wechat-api/event-platform.test.mjs` |
| API-B | `tests/wechat-api/booking-flow.test.mjs` |
| API-M | `tests/wechat-api/native-management.test.mjs` |
| 布局 | `tests/e2e/mini-program.spec.ts`（320/390/430 三宽） |

## 1. 观众

| 需求 | 来源 | 入口页面 | API | 状态 | 证据 | 剩余依赖 |
|---|---|---|---|---|---|---|
| 公开赛事、赛程、比分、排名、分组、淘汰 | P05-B、C04、IA | event、match | `/v1/public/events/:id/*` | 已验证 | API-E（分享直达、撤销后清屏）、VM | — |
| 分享与最近观看（本机仅存公开身份，404 自动移除） | C14 | event、watch | 同上 | 已验证 | API-E | — |
| 手输观赛编号（降为“其他方式”，兼容旧链接） | C13/C14 | watch | 同上 | 已验证 | VM | — |
| 已发布媒体与时间标记的公开播放 | C05 | match、media | `/v1/public/…/media` | 已验证（数据）/ 待验证（播放） | API-M 匿名核对发布、撤销、标记 | 真机播放、外链在微信内的可播性 |
| 公开赛事目录 | 商业规划、C13 | watch“公开赛事” | 无 | **待审** | — | 待审包 §1 |
| 赛季或跨届数据榜 | C14 | — | 无 | **待审** | — | 待审包 §3 |
| 关注与开赛/赛果提醒 | C14 | account“关注与消息”（规划说明） | 无 | **待审 + 外部** | — | 订阅消息模板与凭据 |

## 2. 主办方

| 需求 | 来源 | 入口页面 | API | 状态 | 证据 | 剩余依赖 |
|---|---|---|---|---|---|---|
| 我的赛事（每机构最多 500 届，分页读取） | C13、C16 | watch | `/orgs/:o/events?cursor` | 已验证（首页）/ 待验证（多页） | API-E；VM（分页、截断与后续页失败） | — |
| 创建与编辑赛事草稿 | P03-A | event-setup | `POST/PATCH events` | 已验证 | API-E | — |
| 报名、记分、积分规则（秒级节时、同分顺序无损） | P03/P05 | event-setup | `*-rules` | 已验证 | API-E、VM | — |
| 组内积分规则（分组赛发布前锁定） | C05 | event-setup、schedule | 同上 | 已验证 | API-M | — |
| 公开观赛开启、关闭、历史 | P05-B、C03 | event-setup | `public-viewing-commands` | 已验证 | API-E、API-M（每轮发布后重新开启） | — |
| 报名审核与开放、截止、冻结 | P03-A | entry-review | `entries/*/commands`、`registration-commands` | 已验证 | API-E | — |
| 单循环排赛（场地、对阵、排时、校验、发布、重抽） | P04-A | schedule | `schedule-revisions/*` | 已验证 | API-E | — |
| 单淘汰签位、轮空、逐轮发布 | C04 | schedule、bracket | `knockout`、`knockout-round-commands` | 已验证 | API-M | 淘汰轮次时间手工选择，无自动建议 |
| 分组均衡抽签、种子、同分抽签、出线、交叉淘汰 | C05 | schedule、bracket | `groups`、`group-tie-commands`、`group-qualification-commands` | 已验证 | API-M（含来源赛果变化被拒、已采用赛果不可重开） | — |
| 正式改期（冲突、历史、原发布保留） | P04-B | org-match → reschedule | `rescheduling`、`reschedule-commands` | 已验证 | API-M | — |
| 场地新增、改名、停用、启用 | P04-A | schedule“场地管理” | `POST/PATCH courts` | 已验证 | API-M（改名；有未来比赛时停用被服务端拒绝）、VM | — |
| 单场人员分配（记分员、复核人） | P05-A | org-match | `PUT matches/:m/staff/:u` | 已验证（机构负责人） | API-E | 非负责人管理员无成员列表权限（服务端规则 `listMembers` 仅 OWNER），页面提示在 Web 分配 |
| 赛事级工作人员（EVENT_MANAGER 等）授权 | P02 | 无 | `PUT events/:e/staff/:u` | **缺交互**（Web 也未提供） | — | 无既定交互需求，且成员列表同上限制；本期不做 |
| 机构成员与角色维护 | P01 | 无 | `GET/PUT members` | **缺交互** | — | 属机构权限配置，本期按约定不在小程序修改 |
| 准备比赛、记分台、租约、计时、撤销、补录、结束 | P05-A、C02 | org-match、scorer、scoring-tasks | `commands`、`scorekeeper-lease` | 已验证 | API-E（含丢失响应按原 commandId 恢复） | 真机弱网 |
| 独立确认、重开 | P05-A | org-match | `CONFIRM_RESULT`、`REOPEN_RESULT` | 已验证 | API-E、API-M | — |
| 完赛、归档、重新开放 | C03 | org-event 管理卡 | `lifecycle-commands` | 已验证 | API-E | — |
| 积分榜与本届球员基础数据 | P05-B、C02/C03 | org-event | `standings`、`player-statistics` | 已验证 | API-E | 未采集项目显示“未统计” |
| 比赛媒体：私有上传、草稿、发布、撤销 | C05 | org-match → match-media | `media-files`、`media`、`commands` | 已验证 | API-M | 上传无请求幂等（安全保留未知，见 §6） |
| 比赛媒体：私有预览、撤销后清除内容、视频时间标记 | C05（Web 已有） | match-media | `media-files/:f/content`、`PURGE`、`markers` | 已验证 | API-M（预览字节、清除、带标记发布后公开可见）、VM | 真机视频播放 |
| 比赛媒体：外部链接（仅受信主机） | C05 | match-media | `POST media`（EXTERNAL_LINK） | **待验证** | VM（主机、协议、端口、片段拦截；未知结果保护） | 服务器需配置 `trustedExternalHosts`，隔离环境未配置 |
| OBS 独立比分包装 | P06-A | Web / OBS | overlay | **规划**（非小程序范围） | — | — |

## 3. 球队与领队

| 需求 | 来源 | 入口 | API | 状态 | 证据 | 剩余依赖 |
|---|---|---|---|---|---|---|
| 我的球队、成员维护、接受邀请 | P03-A、C08 | teams、team、invitation | `teams`、`invitations/*/accept` | 已验证（邀请）/ 待验证（成员维护） | API-E（原生接受邀请）、VM | — |
| 可报名赛事、本届报名、名单、提交/撤回、补交、冻结后只读 | P03-A | registration-events、entry | `entries/*` | 已验证 | API-E、VM | — |
| 报名私有资料上传与查看 | C05 | entry | `entries/*/media-files` | 待验证 | VM | 实名与保险“核验”属外部 |
| 球员自建或自主加入球队 | C14 | — | 无 | **待审** | — | 待审包 §2 |

## 4. 球员预约（扩展服务）

| 需求 | 来源 | 入口 | API | 状态 | 证据 | 剩余依赖 |
|---|---|---|---|---|---|---|
| 资料提交与平台独立审核 | C08–C11 | player-center、platform | player-booking | 已验证 | API-B | — |
| 球员广场、详情、数据、同价比较 | 同上 | players、player、compare | 同上 | 已验证 | API-B、VM | 数据只计授权且独立确认的记录 |
| 五类预约、订单、接单、逐场到场与完成 | 同上 | booking-create、bookings、booking-detail | 同上 | 已验证（单场）/ 待验证（其余四类为 VM） | API-B、VM | — |
| 变更、取消、争议、原命令恢复 | 同上 | booking-detail | 同上 | 待验证 | VM | — |
| 数据授权（提名与本人同意） | C07 | performance | performance-links | 待验证 | VM | — |
| 支付、退款、分账 | 商业规划 | 各预约页标注“支付未开放” | 无 | **外部** | — | 商户号、证书、合规审查 |

## 5. 我的

| 需求 | 来源 | 入口 | 状态 | 证据 | 剩余依赖 |
|---|---|---|---|---|---|
| 账号登录、注册、切换、退出；会话变化清空私有页面 | P01、C13/C14 | account | 已验证 | API-E/B/M（切换后各页清空） | — |
| 微信登录与绑定 | C05-WECHAT | account | **外部** | VM | 服务端配置已提供 AppID 的 secret、合法域名，真机 |
| 分组入口：我的赛事、赛事管理、记分与确认、球队、预约、球员中心、数据授权 | C14/C16 | account | 已验证 | API-E | — |
| 关注与消息 | 规划说明页 | account → planned | **待审 + 外部** | — | — |

## 6. 跨模块可靠性

| 事项 | 状态 | 说明 |
|---|---|---|
| 读写并发（hold/held）、会话版本、CAS、租约、原 commandId | 已验证 | C14 审查修复，API-E、VM |
| 媒体上传与草稿的未知结果 | 已验证（**安全保留**） | 先存后发、存储失败即停、不淘汰未解决记录；**不是幂等恢复**。幂等方案待审（待审包 §4） |
| 上传字节进度、分片上传 | **待审** | 现有接口为单次 JSON；需新上传 API |

## 7. 外部依赖（准确缺项与接入位置）

| 能力 | 缺项 | 小程序接入位置（现状） |
|---|---|---|
| 支付、退款、分账 | 微信支付商户号、API 证书与密钥、分账资质、合规审查 | booking-create、booking-detail、platform、planned（均标注“未开放”，不调用 `requestPayment`） |
| 订阅消息 | 已提供 AppID 下的订阅模板、发送凭据与配额 | account“关注与消息”（规划说明） |
| 实名与保险核验 | 核验服务商与资质 | entry（只上传资料，不代表核验） |
| 云直播与转码 | 直播或转码服务、费用审批 | match-media（只有 8 MiB 内的 MP4 与受信外链） |
| 正式发布 | 已提供 AppID 的服务端 secret 配置、合法域名、隐私说明、真机 | 全部页面 |

## 变更记录

- **C14**（`1535890`）：首版清单。当时分组/淘汰、改期、媒体上传标为“仍在 Web”。
- **C15**（PR #24，`e9f626e`）：上述三项改为原生实现并通过真实联调；媒体未知结果改为安全保留。
- **C16**（本分支）：
  - 补齐媒体外部链接、时间标记、撤销后清除、私有预览；
  - 我的赛事分页（每机构最多 500 届）；
  - 场地改名、停用、启用；
  - 建立统一待审包；
  - 本清单改为六类状态口径。
