# C04 验收证据

2026-10-23（Asia/Shanghai）；root；DONE / MAIN。基线main4617020，分支feat/C04-single-elimination。本机源码/strict/build、独立静态、隔离PG/真实浏览器/HTTPS/恢复与生产结果分别记录。本轮无生产操作，原生OBS与真实手机未验证。

已实施原比赛单淘汰投影、首轮轮空、逐轮发布与来源锁定、公开只读/闭赛及41表/11Migration恢复扩展。011 SHA256以最终提交读取，不提前称已执行。真实PG/Docker/Chromium需既有隔离CI；测试计划不能当结果。最终命令、计数、CI链接、源码tree和审查将在执行后补录。


本机整合检查：npm test 64文件749项（admin363/API386）全过；npm run typecheck（含tests）、npm run build、npm run format:check与git diff --check均0。原001–010 diff为空。独立静态[记录](independent-review.md)已核验人员安全维护版本P1修复，无未修确定P1/P2；security未运行。15项PG/18真实API+4HTTPS/完整恢复均为已写驱动、尚待CI实际执行。


## 最终候选实测

[PR12](https://github.com/xyq-dev/small-city-basketball/pull/12)，sourcebc6516dc0068812c8075f9a88effa89c4183190f，merge7ef18c915ffa51712077e6668e60ec6fbb0219b6，精确tree5446bdacb6c5fc08fab245cecad74b91b1028a5d。

| 证据 | 实际结果 |
|---|---|
| 本机与CI源码 | admin363/API386＝749、全strict/build/格式通过 |
| 真实PG | api201+production16＝217，新C04的15项通过 |
| 浏览器 | 12Mock；真实API桌面9/手机模拟9（各3.3min），可信HTTPS4项（含新C04公私签位/最终名次/旧键不可用）全部通过 |
| 持久与恢复 | 11Migration/checksum，41表真实PG重启/完整dump第二实例恢复精确一致，C04真实首轮轮空+推进凭证+最终历史/sourceHash一致，备份点fence与旧授权隔离通过 |
| 清理 | 正常/故意失败只清本轮owned库/项目，独立control保留 |
| 审查 | sourcebc6516d自动CodeReview completed无finding/未解决线程；独立静态P1修复复核CLEAR，security未运行 |

[CI39975284464](https://github.com/xyq-dev/small-city-basketball/actions/runs/39975284464)三个job全部SUCCESS、无重试；admin120488153852 / api120488154061 / production120488154066完整日志已核对。011 SHA256 `23027d473167ae319b826b3bc2167baea7d59e548f7e75b58294db5ddbcccce3`，001–010未变，只隔离CI执行。合并后[CI39976904075](https://github.com/xyq-dev/small-city-basketball/actions/runs/39976904075)三个job同范围全部SUCCESS，完整日志已核对，无重试。没有生产部署、旧007已落库FINAL升级、原生OBS或真实手机验证。


合并后最终核对：CI39976904075，head7ef18c9，attempt1，admin120493758284 / api120493758162 / production120493757852全部SUCCESS，同范围检查完整通过，无重试。API浏览器依赖安装耗时不当作测试通过；安装完成后的桌面9/手机9均实际通过。main后续只有文档同步，应用/测试/运维代码仍与已验merge一致。
