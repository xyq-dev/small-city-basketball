# C02 验证证据矩阵

2026-10-23（Asia/Shanghai）；root集成分支`feat/C02-commercial-core`，源HEAD`153421668ea74378df859a4b7c21df7da11ad77e`，未提交。以下是本批候选代码证据，不是线上验收。

| 证据 | 执行者/方式 | 实际结果 |
| --- | --- | --- |
| 完整源码测试 | root，本机`npm test` | 573通过：admin294/32文件、API279/21文件；含DOM/Mock，不等于真实浏览器或PG |
| 严格类型 | root，`npm run typecheck` | 两workspace及tsconfig.tests通过；PG测试代码也做类型检查 |
| 构建/格式 | root，`npm run build`、`npm run format:check` | 通过；最后SVG布局修复后完整源码重跑、admin再构建通过 |
| 历史Migration | root，与HEAD逐字节对比 | 001–007不变；008/009仅编写；Migration数、manifest已同步 |
| 独立静态审查 | validation_runtime只读复核 | 三类发现已修复，无未解决静态阻断；[记录](C02-security-review.md) |
| 独立源码复核 | validation_runtime | 统计8、维护/validation21通过；是573子集，不另累加 |
| SVG布局 | root/导出作者，Inkscape与几何回归 | 修复长队名/时间行重叠；无中文字体，不算浏览器/手机验收 |
| 新真实PG用例 | 作者编写、root严格类型 | 7统计＋8账号＋5旧schema升级＝20项，未运行；不等于旧FINAL比赛完整升级 |
| API浏览器 | root，Playwright `--list` | 16项可发现，含桌面/手机两模式；未执行 |
| 本机真实运行条件 | validation_runtime | loopback200并关闭；PG/Docker缺失、Chromium下载失败；[记录](C02-validation-runtime.md) |
| PG/重启/恢复/容器/真实浏览器 | 本轮未执行 | 受环境阻塞，不计通过；不能用Mock或旧CI替代 |
| 新CI/生产/真实OBS/微信/Safari | 本轮未执行 | 无新提交/CI/生产操作；服务器旧版报告另列CURRENT_STATUS |

详细范围、指纹及接续操作见[任务卡](../../tasks/C02.md)和[交接](../../handoffs/C02.md)。
