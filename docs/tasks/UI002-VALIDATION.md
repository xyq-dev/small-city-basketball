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
