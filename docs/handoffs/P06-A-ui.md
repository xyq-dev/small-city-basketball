# P06-A UI 交接

2026-10-22（Asia/Shanghai），负责人 `/root/p01_ui`，IN_PROGRESS / LOCAL_ONLY。

## 开工核验

目录 `/workspace/scratch/93747c9ad2cb/p06-admin`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/P06-overlay-ui`，基线 `ca68dea89f1625c86e2a90e43ffa936c49fd6186`。开工仅有未跟踪 node_modules 复用软链接，不提交。已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION 和 P06-A 完整任务卡。

允许路径为 `apps/admin/src/overlay/**`、`api/overlay.ts`、App/Runtime 必要入口及回归与本交接；不改合同、根配置、其他既有业务模块。仅本地提交，不 push。

## 计划与接口检查点

API 精确 DTO 尚待 root 分发；不自行发明接口。先实现独立透明入口及共用 1920×1080 下三分之一 renderer。索引复用事件列表及该赛事正式 matches，不使用含 match-only 工作人员的 scoring-matches。坏 FINAL 的 previewError 不阻塞授权元数据与撤销。

源生命周期必须保证 StrictMode fragment 初始化、无 Storage、串行轮询及 8 秒超时、30 秒陈旧清屏、请求发送锚点硬截止只提前、404/过期终止及晚响应拒绝。管理写使用服务端 capabilities/CAS，丢失 ACK 先读元数据、不重复签发。

## 验证状态

尚未运行源码测试、构建或真实浏览器；不是 P06 验收证据。计划执行风险单元/组件、完整 admin、strict/type/build/format。root 负责真实 API/PG/浏览器及整合；原生 OBS/CEF 尚未验收。

## 2026-10-22 实施与验证检查点

精确 DTO 源 `6ebcf188c317da525f02b15ae9525f55debfd5eb` 经 root 授权，已 cherry-pick 为本分支 `5400c9c`；不自行改变合同。已完成：机构赛事→正式场次索引、按服务端能力签发／轮换／撤销及固定 TTL、Event/Grant CAS、坏 FINAL 仅清预览、遮罩的一次性链接复制、丢失 ACK 必须先读取元数据；独立透明入口、StrictMode fragment 内存 bootstrap、专用 Cookie、不触发私人登录／邀请、共享1920×1080 renderer、长名称安全换行、raw clock 单次插值、2秒串行读取／8秒超时、完整 RTT 保守截止且只提前、离线即陈旧及30秒清屏、404／到期终止、409来源故障可恢复、换 URL 与晚响应保护。

实际执行：`npm run test --workspace @small-city-basketball/admin -- src/overlay src/api/overlay.test.ts`，24项通过；`npm run typecheck --workspace @small-city-basketball/admin` 通过；完整 `npm run test --workspace @small-city-basketball/admin` 22文件171项通过（旧147＋新24）；`npm run build --workspace @small-city-basketball/admin` 通过。新增与必要入口文件已 Prettier。尚未执行真实API／PG／原生浏览器或 OBS 客户端验收；由root后续整合。无 Migration 修改或执行，无远端推送。

关键可访问名称：赛事、授权有效分钟、轮换理由、撤销理由；签发包装链接／轮换包装链接／撤销包装链接；确认签发／确认轮换／确认撤销；复制浏览器源链接；包装主队比分／包装客队比分／包装剩余时间。所有新 select／textarea 具有显式稳定 aria-label。

当前为 BRANCH_ONLY 待 root 整合与独立复核；不标记 MAIN 或 DONE。下一位先读取本 UI 提交与任务卡，再 cherry-pick UI 源提交（精确合同已由root独立整合，不重复cherry-pick5400c9c）；运行真实浏览器／PG验收。原生 OBS/CEF透明合成、隐藏卸载／刷新及保存源重启仍未验证。
