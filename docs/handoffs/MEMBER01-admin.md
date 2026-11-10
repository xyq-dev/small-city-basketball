# MEMBER01 admin · 按届模板与权益核对快照

2026-11-10 15:27 Asia/Shanghai；负责人 `/root/membership_reference`；REVIEW / LOCAL_ONLY，等待 root 整合与隔离 CI。

## 现场与范围

- 工作树 `/workspace/scratch/dc6a786e1a31/scb-membership-ui`，分支 `feat/member01-price-presets`，基线 `fb6cc396f42022189156f4d979ae1d32662747b8`。开工干净；origin 为 `https://github.com/xyq-dev/small-city-basketball.git`。
- root 是唯一集成人；本作者仅修改 `CommercePages.tsx`、其直接测试、新的 `membership-presets.ts` 与直接测试及本交接。未修改汇总文档、API 解析、contracts、后端、全局或本页 CSS、导航、球队成员、支付写入逻辑及迁移。
- 依赖复用 root 已安装的 node_modules，未安装或更改依赖/锁文件。验证后仅移除本作者创建的两个临时符号链接，不影响目标目录。

## 已实现

平台操作员原“创建套餐新版本”表单内加入原样式的模板选择与“载入建议模板”。三档建议：

| 代码 | 名称 | 元/届 | 最多球队 | 最多比赛 | 付款后激活有效天数 |
|---|---|---:|---:|---:|---:|
| scb_event_basic | 小城市·基础赛事包 | 99 | 8 | 32 | 90 |
| scb_event_standard | 小城市·专业赛事包 | 299 | 16 | 128 | 180 |
| scb_event_business | 小城市·商业赛事包 | 599 | 32 | 512 | 365 |

模板不是可购买目录，也不意味着这些价格已经发布。载入先复用原 Modal 确认覆盖本地定价字段，保留发布原因，取消保留全部原输入。确认只更新 React 本地表单，不进入 API/action.run，不发布、扣费或开权益。之后仍需独立“核对并发布套餐版本”与原确认流程才向既有 `/v1/platform/commerce/plans` 发 POST；使用届时实际字段，允许操作员编辑建议。既有真实套餐卡始终展示服务端价与版本，机构采购与非平台操作员不显示建议模板。

机构“本届软件权益”按可选服务端 `activationStatus` 与 `statusCheckedAt` 展示核对快照。撤销优先于已激活；旧 API 没有投影时仅从原 revokedAt/activated 确认撤销/激活，其余中性“激活状态待核对”。READY/EXPIRED/REFUND_PENDING/UNAVAILABLE 必须有服务端核对时间，前端不比较本机当前时间判断可激活。截止与核对时间明确为北京时间；截止是新激活期限，不是赛事停止记分时间。首次发布仍服务端重验，界面没有增加激活或授角色按钮。

## 实际验证

- `npm run test --workspace @small-city-basketball/admin -- src/commerce/CommercePages.test.tsx src/commerce/membership-presets.test.ts`：2 文件、22/22 通过（原 UI 5 项 + 新 UI 15 项 + 模板纯函数 2 项）。使用合成响应，**不是实际付款、PG 或真实 API 验收**。
- 回归覆盖三档载入确认/取消/保留原因/零 POST/不覆盖服务器已发布金额、后续独立发布使用编辑后的当前字段与原 API、采购者和非操作员隐藏入口、六种服务端状态、READY/EXPIRED 不随浏览器现在时间推断、旧 API 三种降级以及不新增角色/激活命令。
- `npm run typecheck --workspace @small-city-basketball/admin`：通过。
- `npm run build --workspace @small-city-basketball/admin`：通过；Vite 仍报告既有主 chunk 超过 500kB 的非阻断提示，未修改阈值。
- 本次四份源码的 Prettier 与 `git diff --check`：通过。

## 未验证与接续

未在本工作树执行真实 PG、桌面/手机浏览器、截图对照、微信真机、支付网关或生产操作。新会员中心视觉设计与月/年跨届订阅不属于本切片；本页只复用现有布局。Migration 无需编写，未执行。

已授权仅本地精确路径 commit；本作者不 push/PR/merge/部署。由 root 检查提交后整合自己的 contract/API 解析与后端状态投影；再按任务卡跑同 head 隔离 PG/桌面与手机 API 浏览器、审查、提交与普通同步流程。源分支与现有其他 checkout 保留，不 reset、清理或覆盖他人工作。
