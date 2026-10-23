# C02 验证证据矩阵

2026-10-23（Asia/Shanghai）。PR[10](https://github.com/xyq-dev/small-city-basketball/pull/10)已合并e5d4782，最终源ec74c47、共同tree34b755e77dbcf20156b673505ee38e3b5697172f。**本卡DONE / MAIN；没有生产部署证据。**

| 证据层 | 实际执行与结果 |
| --- | --- |
| 本地整合 | root573源码、完整严格类型/构建/格式/diff通过；本机缺PG/Docker/Chromium，不计本地真实运行 |
| 候选完整CI | [39919192641](https://github.com/xyq-dev/small-city-basketball/actions/runs/39919192641)三个job全部SUCCESS |
| CI源码与Mock浏览器 | admin120300426375：294管理端＋279API＝573源码、严格类型/构建/格式、12Mock浏览器通过 |
| 真实PG | api120300426291的169＋production120300426526的16＝185通过，其中C02新增20项（7统计/8账号/5旧schema升级） |
| 真实重启 | TEAM_ONLY时钟＋PLAYER_BASIC归属/未归属/两次确认与40表指纹保持，Migration checksum一致 |
| 真实API浏览器 | 桌面8＋手机模拟8通过，含排时建议预览/采用/保存、两模式统计/更正/确认/断线、CSV/SVG下载/解码/隐私/撤销/手机无溢出 |
| 可信HTTPS及完整恢复 | 4真实浏览器、三非root镜像/最小角色、完整dump/restore/隔离和正常/失败owned清理通过 |
| 静态审查 | [初轮记录](C02-security-review.md)；后续P1恢复计数7→9已独立复核，并由真实恢复证明；自动最终ec74c47 CodeReview completed无新finding/未解决线程，security未运行 |
| 作者/独立源码 | 作者本机及独立8统计/21账号是上述573子集，不另加总；作者handoff不是独立CI证据 |
| 早期SVG布局 | Inkscape发现并修复长队名/时间行重叠并加回归；无中文字体，不算中文视觉验收 |
| 合并后CI | [39920273639](https://github.com/xyq-dev/small-city-basketball/actions/runs/39920273639)三个job全部SUCCESS（无重试）：573源码/185真实PG/12Mock＋20真实浏览器、两模式重启/完整恢复/隔离及清理均复跑通过 |
| 生产/真机 | 本轮未部署/正式Migration/账号维护；真实OBS、微信/Safari真机及中文字体视觉/打印对照未验 |

失败没有删去：首轮39918105548为账号造数429（164/5），第二轮39918705083备份指纹计数遗漏；均最小修复，最后整轮重跑成功。详见[交接](../../handoffs/C02.md)。旧schema升级夹具仅旧用户/凭据，不冒充原007已有FINAL完整落库升级。

本地运行条件仍见[记录](C02-validation-runtime.md)，其“未运行真实PG/浏览器”专指作者当时本机，不覆盖后续CI。静态审查不代替PG/浏览器；以上CI也不代替服务器部署或真实OBS验收。
