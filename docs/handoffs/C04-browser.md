# C04 真实 API 浏览器驱动

2026-10-23（Asia/Shanghai），负责人 c04_browser。IN_PROGRESS / LOCAL_ONLY（测试驱动已编写，实际 PG/Chromium 待 root 隔离 CI）。

## 现场与所有权

独立目录 `/workspace/scratch/dc6a786e1a31/c04-browser`，分支 `feat/C04-browser`，基线 `4b489973ce3937f860d4053130e8abe6e598c275`，origin 为原项目。开工干净；依赖链接 `node_modules`、`apps/api/node_modules`、`apps/admin/node_modules` 是本工作树的未跟踪运行依赖，不提交。已读 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、C04 卡与共享合同。仅写 `tests/api-e2e/knockout.spec.ts` 和本记录，不改业务实现、共享合同、App、其他测试或 CI。

## 已编写范围

- 新增一个每浏览器项目独立执行的真实 API 验收测试，沿用 `playwright.api.config.ts` 的 desktop-api / mobile-api（390px）与原隔离 DB runner，无 Mock / route interception。
- 只在明确 `scb_test_*`、非 production 数据库写入三个合成身份及合成机构/负责人关系，然后全部通过真实 `/v1/auth/login` 建立会话；不调用注册接口，不修改/清空安全限流，不依赖其他测试身份或执行顺序。业务赛事/报名/冻结/排赛/计分/确认/观赛授权全部真实 HTTP，不直改业务表。
- 三队单淘汰：首轮一个真实比赛、一个轮空；原独立确认后才出现决赛预览。管理页面浏览器填写场地/日期/原因，打开确认框时再次核实尚未写入，点击明确确认才新增第二场。核验旧 LIVE 观赛键永久404、来源比赛 canReopen=false、合法匿名写命令401。
- 决赛复用原单端 lease、记分事件/校时及独立确认，最终名次 1/2/3 来自实际获胜队；管理页刷新展示最终名次。
- 新显式匿名观赛授权，以独立匿名 browser context 访问新链接、切换“晋级与名次”、查看公开签位和最终名次。检查 DTO 不含内部 entry/team/roster IDs、成员姓名、seed、来源写参数；匿名页面无发布/确认/控制按钮。
- 管理页与公开页均检查实际文档宽度不超过 viewport；收集 pageerror 并要求为空。UI selectors 已与 c04_ui 负责人对齐，待集成后以实际 CI 结果为准。

## 本机验证与未验证

已执行 `node node_modules/prettier/bin/prettier.cjs --write tests/api-e2e/knockout.spec.ts` 和 `npx tsc --project tsconfig.tests.json`，均 exit 0。未在本机运行真实 PostgreSQL、桌面/手机 Chromium；本机不具备所需运行时，不能据类型检查声称浏览器通过。没有生产、真实账号、OBS/CEF 或真机微信/Safari 操作。

## 接续

root 按明确文件路径整合后，运行完整类型/格式检查并通过现有隔离 CI 执行两个浏览器项目；新测试使每项目 8→9 条（若其他作者另加测试，以实际计数为准）。CI 若报告消费者或选择器差异，应修业务/合理验收点并重跑，不删断言或放宽生产安全。未 commit / push，所有修改保留在本工作树。
