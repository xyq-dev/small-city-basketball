# ACCOUNT-SECURITY：首次部署自行设置密码与本人改密

- 状态：REVIEW / LOCAL_ONLY，2026-11-06 Asia/Shanghai。
- 集成人：本会话 Codex root；初始化 backend：bootstrap；改密 backend：password；Web：web；部署文档：deploy_docs。
- 实际目录：`/workspace/scratch/1de45fa14969/small-city-basketball`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 基线：`ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`，clone 后 main 工作区干净。
- 当前任务分支：`feat/self-service-owner-password`，本地新建；不操作其他本地或 UI 工作区。
- 权限：代码、必要文档、新 Migration、临时隔离 PostgreSQL 执行 Migration、测试与构建。
- 禁止：commit/push/PR/merge/发布打包/部署/生产 Migration/生产账号数据/DNS/Caddy/云资源。
- 范围：首次初始化令牌与持久关闭、现有 bootstrap-owner 互斥、注册门禁；本人改密原子撤销会话与恢复码；必要 Web 表单、部署文档及最小权限。
- 共享文件：app.ts/service.ts/registration-service.ts/runtime-config.ts 由 root 写；049 与 privilege manifest 由 bootstrap 写；admin 与 nginx 模板由 web 写；Compose 与部署说明由 deploy_docs 写。
- 不修改微信 UI、支付与无关业务。测试仅合成身份与独立临时数据库。
- 计划验证：直接单测、真实 PG 并发/回滚/旧实例/最小权限和 /ready、类型检查、构建、可用的浏览器表单验证。未执行项目不得记通过。

## 检查点 1

已执行仓库目录、HEAD、远端、分支和 dirty 核验，阅读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION。npm ci 成功。正在建立临时 PostgreSQL 环境。没有连接生产，没有 Git 提交或推送。

## 检查点 2（2026-11-06 Asia/Shanghai）

首次初始化、改密及管理端表单已实现。API 单测首次因旧 readiness 数量断言失败，更新为49后完整1344/1344通过；额外初始化 CLI 边界单测已由子任务22项验证。管理端完整598/598通过。真实PG18.6：首次初始化12/12、改密与既有维护/恢复28/28、security/registration/WeChat回归56/56、实际runtime完整HTTP链路1/1通过；runtime链路同时在初始测试身份scb与scb_admin下验证。

最小权限验证发现LOCK TABLE SHARE仍要求超出现有SELECT的权限，已删除表锁，统一使用所有真实账号创建入口共享的singleton行锁，未扩大runtime权限。宿主私密终端与CI校验补充完成，5/5通过；安全独立复审无阻断发现。实际重启临时PG进程两次验证过期时间不续期、过期码拒绝以及初始化完成不可重开。完整类型检查/构建已通过，最终格式与类型检查正在收口。

浏览器验收受阻：Playwright Chromium下载内容损坏；备用Chromium153启动SIGSEGV，尚未打开页面。没有将React测试说成浏览器通过。没有Docker可执行文件，Docker/真实HTTPS容器演练与完整归档恢复未执行。上述均不是生产结果。

## 最终收口（2026-11-06 Asia/Shanghai）

- 功能代码和直接相关隔离验证完成，状态REVIEW / LOCAL_ONLY，不标记main或生产完成。
- 最终全API源码单测118文件1345/1345；完整管理端598/598；选定真实PG102项通过（初始化12、改密及维护/恢复28、认证/报名/微信56、P07首owner5、runtime链路1）。另有实际PG重启验证与宿主CLI5/5、恢复包装1/1、Migration静态检查通过。
- 最终根类型检查、构建、完整format:check与git diff --check通过。浏览器、Docker/HTTPS容器和c22完整归档恢复未执行，详情见交接。
- Migration049仅在临时PG执行，生产未执行；历史001–048未修改。没有修改微信UI，没有commit/push/PR/merge/部署或生产账号数据操作。
- 已保留全部本地未提交源码和文档，完整diff补丁另行交付；补丁须应用于上述基线，先git apply --check并保留目标已有改动。上线前先补浏览器、隔离Docker/HTTPS和旧库恢复验收，再按后续授权进行Git或发布。

## 2026-11-06 接续提交阶段（IN_PROGRESS / LOCAL_ONLY）

用户在本会话明确要求直接按已设计的Codex提示词操作：授权相关修复与测试、commit、普通push、Draft PR及CI检查/必要修复；仍禁止merge、部署、发布打包、生产Migration/账号数据/DNS/Caddy/云资源。本节覆盖此前“禁止commit/push/PR”的历史阶段限制，不扩大生产权限。

执行前复核：目录、分支、HEAD及50项现有任务变更与上一阶段一致；远端main仍为ef62cb1，无Migration编号冲突，无同名已有PR。root继续唯一集成。发布前独立复核发现并正在修复纯测试配套：浏览器fresh DB受新注册门禁拦截、runtime夹具应还原共享测试角色、r6-training直接注册夹具需受控初始化。产品门禁与权限不放宽。

### 提交前增量验证

已修正本阶段发现的测试基础设施兼容问题，未改变产品门禁：浏览器测试启动增加受控synthetic owner初始化，7项脚本测试及真实PG注册前后验证通过；根npm test已包含此7项。训练夹具先建立首owner再并行建号，真实PG19/19；共享register夹具只有在持久完成后才允许竞争失败者走正常注册。c02维护/change-password/x22恢复夹具在beforeAll受控初始化，28/28重跑通过。runtime测试严格接受已知隔离角色基线，恢复原NOLOGIN/NULL-password migrator属性，按OID清除仅本次新建角色，3/3真实PG通过（含失败清理与拒绝未知角色基线）；没有读取或保存密码哈希。类型检查、完整格式检查、CLI/浏览器准备12项通过。测试配套代码已完成独立复核；准备提交及同步远端。
