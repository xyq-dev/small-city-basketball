# C10 球员档案、中心与数据授权视觉还原

2026-10-25；负责人 c10-profiles；供集成人汇入 C10。状态：本地实现与直接回归完成，真实渲染截图及用户验收待集成。

## 现场与边界

- 仓库 `https://github.com/xyq-dev/small-city-basketball.git`；工作树 `/workspace/scratch/608836f8d204/c10-profiles`；分支 `feat/c10-profiles`；开工 HEAD `55d5dd9ac50b07f9cfa4a3cdf484eead1f9a7064`，开工工作区干净。
- 已按 AGENTS 读取当前状态、任务、协作流程和 `docs/tasks/C10.md`；root 为唯一集成人。本分支仅占有三页模板、样式、必要展示 JS、独立 fixture/回归及本文；汇总任务卡与交接由 root 更新。
- 不改 shared utils、app.wxss、API、费用契约、数据模型、后端或 Migration。没有 push、merge、部署、真实数据操作、新凭据或付费资源。

## Figma 来源与实现

先读取 `figma:figma-design-to-code`，再对下表原稿调用 `get_design_context`，包含截图和 `skillNames: resource:figma-design-to-code`。文件 `2jAHpYjdIHqal1nXeoVqm6`，原始高保真文本与 PNG 均保存在 `/workspace/scratch/608836f8d204/c10-design-profiles/`。`references.json` 包含完整文件路径、主图映射和 SHA-256，供根任务包装验收目录；这些原稿只用于对照，没有进入运行界面。

| 原稿文件（同名 .txt / .png） | node | 路由 | 用途 |
| --- | --- | --- | --- |
| player | 30:168 | `pages/player/index` | 主档案 |
| records | 30:206 | `pages/player/index` | 近期个人记录 |
| no-statistics | 30:453 | `pages/player/index` | 尚无个人统计 |
| center | 30:1731 | `pages/player-center/index` | 球员中心 |
| profile-form | 30:1766 | `pages/player-center/index` | 编辑资料 |
| pricing | 30:1804 | `pages/player-center/index` | 编辑报价 |
| availability | 30:1843 | `pages/player-center/index` | 可约时间 |
| pending | 30:1880 | `pages/player-center/index` | 等待审核 |
| changes | 30:1907 | `pages/player-center/index` | 需要修改 |
| disabled | 34:4031 | `pages/player-center/index` | 档案停用 |
| performance | 30:1938 | `pages/performance/index` | 授权列表 |
| consent | 30:1975 | `pages/performance/index` | 本人同意 |
| revoke | 30:2041 | `pages/performance/index` | 撤销授权 |
| nomination | 30:2141 | `pages/performance/index` | 提名对象核对 |
| history | 30:2172 | `pages/performance/index` | 完整历史 |
| revoked | 30:2206 | `pages/performance/index` | 来源失效 |
| permission | 30:2261 | `pages/performance/index` | 权限变化 |

三条默认主图分别是 `player.png`、`center.png`、`performance.png`，对应唯一 `primary: true` fixture。

### pages/player/index

- 对齐原稿：主卡 24px 内边距、12px 间距；信息白卡 16px 内边距和 8px 间距；报价、记录摘要、独立记录按钮、介绍、可约窗口的阅读顺序。记录视图采用 2×2 统计块、独立记录卡和数据说明。
- 派生与实际差异：按现有 `recordsOpen` 在同一路由切换详情/记录；沿用原生页面标题。原稿示例昵称、号码和样本不进入产品；真实数据显示得分、犯规、样本与分母，不添加篮板、助攻等未采集维度。实际接口返回的来源、完整度、时间和限制仍可查看，文字可能比原稿长。
- 真正的 0 仍显示 0；没有采集显示“未统计”；统计读取失败独立显示不可用原因。档案无权限、登录和加载使用实际已有状态；无个人样本对应空统计态，不虚构“所有档案空列表”。

### pages/player-center/index

- 对齐原稿：已审核中心的主卡、本人资料卡、独立入口、资金状态卡与底栏；待审、需修改、停用采用各自原稿的通知/原因/后续处理结构。资料表单按名称/位置、身高/地区成对显示，报价预览和时间窗口分别呈现。
- 派生与实际差异：现有一个原生编辑器按 PROFILE / FEES / AVAILABILITY 三个展示分区对应 C02/C03/C04，保持同一个原 form、save 和提交审核规则，切区不重建草稿、不变更报价、不另发提交。底栏仍保存完整资料；用户可以切回修改其他字段。busy 或原提交待核对时禁止切区。
- 原稿报价为示例；当前费率和报价来自原模型。未开放线上支付及个人分账，保留实收/结算均为 0 的现状说明，不模拟真实资金。原稿可约页的已接单卡没有对应读取模型，N/A；不补造接受订单。已有合作从原“收到的预约”入口处理。
- 无资料的 empty 是真实新申请表单；加载/读取失败/登录、PENDING、REJECTED、DISABLED 和原提交结果未知均有现有状态 fixture。adult 声明保持默认未勾选，切区不自动勾选。

### pages/performance/index

- 对齐原稿：列表从状态标签开始；授权记录独立白卡与全宽处理按钮；同意页分对象、公开范围和本人确认卡，另列声明与原因；撤销页分当前授权、原因、后果与重新公开说明；历史页保留完整分页和旧有效记录操作。
- 派生与实际差异：真实功能有四个过滤模式（含全部历史），保留 ALL 默认与完整历史能力；小屏使用44px横向滚动标签。实际关联对象需要逐条核对，记录显示真实 capability 对应动作及当前来源状态，不能照原稿简化为一条字符串。主办方提名仍是同一路由已有精确赛事/球队/固定名单/档案选择器；新底栏仅定位到表单，不发网络操作。拒绝使用已有 REVOKE 处理 PENDING 的真实分支，复用撤销原稿的卡片语言，不增加假状态；提名各阶段用现有字段/能力派生，不新增路由。
- CONSENT 必须本人新鲜勾选声明；REVOKE 保留原因。身份/权限失效时隐藏旧关联及待确认内容；来源失效不回退旧统计。原请求未知继续按原编号核对，禁止换号重发。历史分页失败保留当前页和 cursor，旧有效授权继续可撤销。

以上为尺寸、层级与信息结构对齐（exact source intent）和真实业务派生（derived）的明确区分；尚未经过截图几何比对，不声明逐像素一致。运行页面全部是原生 WXML/WXSS，没有用 Figma 整张截图代替控件，也没有增加网络图片或资源。

## 合成状态目录

全部 fixture 只使用合成名称与原页面 VM 字段；正常页可见“合成”标识，非正常页保留原产品文案。各页仅一份主正常 fixture。`review/pending/locked` 是截图目录分类，不新增服务端状态。

| fixture 文件 | route | state | 原稿 node | primary |
| --- | --- | --- | --- | --- |
| c10-profile-center-availability.json | `pages/player-center/index` | review | 30:1843 | — |
| c10-profile-center-changes.json | `pages/player-center/index` | pending | 30:1907 | — |
| c10-profile-center-disabled.json | `pages/player-center/index` | locked | 34:4031 | — |
| c10-profile-center-edit.json | `pages/player-center/index` | review | 30:1766 | — |
| c10-profile-center-error.json | `pages/player-center/index` | error | 30:1731 | — |
| c10-profile-center-fees.json | `pages/player-center/index` | review | 30:1804 | — |
| c10-profile-center-loading.json | `pages/player-center/index` | loading | 30:1731 | — |
| c10-profile-center-new.json | `pages/player-center/index` | empty | 30:1766 | — |
| c10-profile-center-pending.json | `pages/player-center/index` | pending | 30:1880 | — |
| c10-profile-center-permission.json | `pages/player-center/index` | permission | 30:2288 | — |
| c10-profile-center-ready.json | `pages/player-center/index` | ready | 30:1731 | 是 |
| c10-profile-center-unknown.json | `pages/player-center/index` | locked | 30:2234 | — |
| c10-profile-performance-consent.json | `pages/performance/index` | review | 30:1975 | — |
| c10-profile-performance-empty.json | `pages/performance/index` | empty | 30:1938 | — |
| c10-profile-performance-error.json | `pages/performance/index` | error | 30:1938 | — |
| c10-profile-performance-history.json | `pages/performance/index` | review | 30:2172 | — |
| c10-profile-performance-loading.json | `pages/performance/index` | loading | 30:1938 | — |
| c10-profile-performance-nomination.json | `pages/performance/index` | review | 30:2141 | — |
| c10-profile-performance-permission.json | `pages/performance/index` | permission | 30:2261 | — |
| c10-profile-performance-ready.json | `pages/performance/index` | ready | 30:1938 | 是 |
| c10-profile-performance-revoke.json | `pages/performance/index` | review | 30:2041 | — |
| c10-profile-performance-revoked.json | `pages/performance/index` | locked | 30:2206 | — |
| c10-profile-performance-unknown.json | `pages/performance/index` | locked | 30:2041 | — |
| c10-profile-player-empty-statistics.json | `pages/player/index` | empty | 30:453 | — |
| c10-profile-player-error.json | `pages/player/index` | error | 30:168 | — |
| c10-profile-player-loading.json | `pages/player/index` | loading | 30:168 | — |
| c10-profile-player-login.json | `pages/player/index` | permission | 30:2288 | — |
| c10-profile-player-permission.json | `pages/player/index` | permission | 30:2261 | — |
| c10-profile-player-ready.json | `pages/player/index` | ready | 30:168 | 是 |
| c10-profile-player-records.json | `pages/player/index` | review | 30:206 | — |
| c10-profile-player-statistics-unavailable.json | `pages/player/index` | error | 30:168 | — |

## 实际验证与限制

- `node --test apps/wechat/test/*.test.cjs`：240/240 通过。本批新增8项直接回归，覆盖31个 fixture 在320/390/430三种宽度的真实模板生成（93次）、0/未统计区别、非审核可约状态、默认声明/提交未知锁、同意门禁、权限失效隐藏、提名入口门禁与编辑分区草稿保留。
- 生成器仅验证原模板输出、可见关键文字和原有门禁，不等同浏览器截图；没有调用真实网络，没有运行无关 API/PG 测试。
- JS 语法、对应 JS/CJS/JSON Prettier 与 `git diff --check` 执行通过。完整列表/宽度截图、溢出、触控目标和原稿几何由 root 在整套候选上生成与核验；本分支不将预览 HTML 当成已截屏证据。
- 官方微信开发者工具编译、真机、原生 picker/textarea 实际行为尚未验证；不能把240项本地回归描述为微信验收通过。用户统一验收仍待整套截图交付。
