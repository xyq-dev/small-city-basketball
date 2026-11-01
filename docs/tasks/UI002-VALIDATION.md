# UI002-VALIDATION：设计断言与根域状态验收

状态：IN_PROGRESS / LOCAL_ONLY，2026-11-01 Asia/Shanghai。负责人ui_validation，root唯一集成人。

实际目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-validation`，分支 `work/ui002-validation`，基线 `283c4f21b64f1e5801db390ac8f8138d233ddbc6`，远端xyq-dev/small-city-basketball，开工clean。已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI002及UI001设计；本地共享Figma节点context和首页PNG为视觉依据。

仅修改root已分配的既有根域测试、mini-program.spec.ts几何断言、旧home/account状态fixture、新增ui002-root状态fixture和自身交接；不修改业务源、其他实施者UI002测试/fixture、测试harness、权限或CSP。

UI001明确替换C11首页照片hero和橙色导航选中。测试改为浅底、16px内容边距、186px起品牌卡、68px原SVG、48px橙按钮配深蓝字；保留其他球员/比较/预约C11几何与全矩阵溢出、44px触控、16px表单可读守卫。

计划执行直接根域回归、全部test:wechat、fixture三宽模板展开、Prettier与diff；浏览器几何/PNG交CI，本地Chrome包下载损坏且字体安装权限受限，不冒称浏览器或真机通过。

## 首片检查点 2026-11-01T14:41:53+08:00

状态：REVIEW / LOCAL_ONLY，源码依赖44911ea（header/safearea）及e70fbb8（同账号退权工作台修复）已cherry-pick，仅作为验证基线，交root时不重复集成。

已完成：8份根域旧测试按UI001迁移；仅精确允许新增nav本地SVG，撤权后禁止事件照片守卫保留；角色工作台测试分别检查个人页和当前授权工作区。14份新fixture覆盖9根路由正常、关闭、失权、长文案与原请求UNKNOWN；42组三宽静态模板展开通过。新增4项交互/真实load退权/fixture集成回归通过；根域既有直接75/75通过。浏览器断言明确替换H01，header84/nav83和非home位置仅抬4px；其他C11照片/比较/预约尺寸不变，通用溢出/触控/字体守卫未删。

`npx tsc --project tsconfig.tests.json --noEmit` 通过。完整`npm run test:wechat`当前1107项：1091通过、15失败、1既有Windows跳过；一项是matching新按钮Unicode箭头（已反馈services/root修源，不放宽守卫），14项是旧微信工具的C11六页来源/selector硬编码与新H01来源冲突（已反馈root接管共享脚本及catalog迁移）。不将该候选标全绿，不称原生微信或真机通过。

本片无业务/API/数据库/Migration/部署变更。下一步root串行同步本片、修共享工具来源后在当前整合HEAD跑完整测试和三宽浏览器/PNG。

## CI167复核与精确设计迁移 2026-11-01T07:29:34Z

续片使用独立目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-validation-followup`、分支 `work/ui002-validation-followup`，基线 `86e503b6d9e5f0b9b445dc43ea9a51adf23c504e`，开工clean；远端仍为xyq-dev/small-city-basketball。只改两份normal home fixture、共享浏览器测试和本任务/交接，源实现由root与services所有者修改。

CI167精确候选c27c416e的admin为1319通过/9失败：两个成熟预约样本的旧12px边距断言、履约样本将placeholder误当正文，均三宽重复。1305份已写布局及6份失败trace的overflow/触控/表单诊断为空；不将该失败候选记为验收成功。视觉复核另发现training等4页同时显示原生导航和自定义header，已交所有者补custom配置；正常home旧空数据只展示初始无mode，也已反馈root。

root直接Figma确认T09/T17内容x16/w358、T09动作5:1239为x16/w358/h48/r12/navy；本片只精确迁移booking-create/bookings两个group的页边、卡片半径与固定主按钮，其他球员/比较几何和所有溢出/44px/16px守卫保留。新增全场景自定义/原生双header互斥断言及布局计数。两份normal home fixture使用真实city-preference.snapshot()生成的NATIONWIDE选择和已加载的合成赛事，保持原来源节点与static标识，不把合成状态当真实接口验收。

本片直接注册、类型及模板检查结果在交接记录；三宽浏览器由后继精确CI执行。无业务/API/数据库/Migration/部署变更，提交仅供root串行集成，未自行push。

2026-11-01T07:30:34Z 独立审查指出续片通用非home动作仍先断言12px，与预约两组新16px互斥，属于本片漏改。已仅排除booking-create/bookings；players/player/compare仍严格12px，所有动作高度至少48px及照片/触控/文字守卫保留。逐段复核其余通用条件与两个新group未发现第二处互斥。类型/注册/格式检查通过后交root串行集成，真实浏览器结果仍等待整合候选CI。

2026-11-01T07:46:05Z CI168精确候选c54cbf1的admin实际1328通过/1314按配置跳过，1314布局JSON与2279原始PNG、73路由、438场景均完整，所有既有overflow/触控/表单及双header守卫通过。原始ZIP摘要与GitHub artifact13074897409一致，实际PNG宽度320/390/430、高844，无失败context。人工检查发现320和390的同城长城市按钮将标题挤成单字竖排，原有横向溢出守卫未能捕获，故不能以CI168作为最终视觉验收。

root接管同城heading最小flex换行修复。本片仅为已有.local-heading记录标题列宽、标题宽及文字行数，并在全矩阵中要求两个宽度均至少180px、原标题1至2行；指标在native-layout.json写出后断言，失败也保留原始诊断。只作用该页面已有局部结构，其他页面的溢出/44px/16px守卫不变。后继候选必须重跑完整CI及重新看实际同城图。
