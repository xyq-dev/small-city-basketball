# P07-A HTTPS 黑盒与浏览器验收交接

2026-10-22，负责人 `/root/technical_docs`，READY_FOR_INTEGRATION / LOCAL_ONLY；真实 TLS／浏览器尚待 CI。

核验目录 `/workspace/scratch/93747c9ad2cb/p07-http`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `test/P07-https`，基线 `f2bf36585f09a0e55df41328a1d25f33e479e012`／tree `80a9b297e780840914ab5f27c6c8cccd9fa3a45d`。开工仅未跟踪 node_modules 复用软链接；不提交。已读 AGENTS、CURRENT_STATUS、TASKS、P07-A 任务卡及协作规则。

独占 `scripts/check-production-http.mjs`、`tests/production/**` 及本交接；不改容器、CI、API、DB、旧测试或共享文档，不启动容器，不 push。root 负责运行中的源服务、受信任自签 CA、私有 owner/state 文件、阶段顺序与恢复隔离。

接口：`SCB_CHECK_BASE_URL` 为显式 loopback HTTPS origin（CI `https://localhost:9443`）；`SCB_CHECK_OWNER_FILE` 为 `{email,password,displayName,organizationName}` 四字段私有 JSON；`SCB_PERSISTENCE_FILE` 沿既有私有 fixture 状态，消费 `event`、`viewing.{publicId,revokedId,overview,matches}`、`overlays.{active,revoked}`。两文件均要求没有 group／other 权限。Node 使用默认 TLS 验证与 `NODE_EXTRA_CA_CERTS`；浏览器须由 root 将独立 CA 导入 runner NSS 信任，不能 ignoreHTTPSErrors 或关闭证书校验。关闭失败截图／trace／video／附件；透明像素只检查内存 PNG，无文件。独立 reporter 只输出固定测试名／阶段／状态，任何默认失败上下文放私有 owner 文件旁目录，不进入 CI artifact，不输出 URL fragment、密码、Cookie 或 state。

Node 负责 TLS／health／readiness／capabilities、Cookie 属性、Origin、no-store、SPA deep fallback 与 API404 JSON、未知凭据的有限错误。浏览器桌面／手机各两例，负责真实 owner 登录并保留私有深链、机构注册关闭／个人注册入口开放及匿名 watch／overlay 入口、无私人初始化请求、bootstrap 前 fragment 清除、URL 无 secret、专用 Cookie 重载及透明像素。登录、bootstrap 与限流允许产生合成 auth／session 写入；不更改任何比赛／授权／公开身份业务数据。Node 复用 fixture source Cookie；匿名浏览器创建自己的 source session，不将 private session 移植到匿名 context。

root 已确认顺序：真实业务 fixture capture → `node scripts/check-production-http.mjs smoke` → `npx playwright test --config tests/production/playwright.config.ts` → **最后** `node scripts/check-production-http.mjs rate-limit` → 停止 API／Web 及全部 writers → 重新采最终 fingerprint／基线并 dump。不得在静止 dump 区间运行这些检查。API 负责人已确认 participant 开关 true 时 register IP20／3600 在 validation 前计数，`{}` 422 不运行密码计算；login 限制是不同的100／900，不能拿它冒充20／小时。本脚本最多21次 `{}`，考虑此前真实注册已耗额度，要求422直至429；再换 XFF／Forwarded／Forwarded-Host／Proto 仍429。不要求前20次全部422，不碰 owner 密码、不读 SQL、不重置限流。

已执行 Node `--check`、`tsc --project tsconfig.tests.json`、独占路径 Prettier 和 `git diff --check`；全部成功。Playwright `--list --reporter=list` 发现精确4例，不连接 DB／服务；默认 reporter 也验证发现4例／0执行。另以缺省配置、HTTP、userinfo、禁用 TLS 四个负向配置探针验证 exit1／固定安全错误且没有服务请求，未输出哨兵或底层异常。提交前再复验最终文件。未运行 TLS、真实浏览器或容器；本地没有 Docker，不将静态检查写成生产／CI验收。root 串行整合并实际运行，必要的共享 CI／格式配置由 root 修改。
