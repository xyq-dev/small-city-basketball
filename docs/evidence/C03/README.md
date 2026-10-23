# C03 验证证据

2026-10-23 UTC；基线main909fb74；候选feat/C03-event-history，尚未合并/部署。详见[任务](../../tasks/C03.md)、[交接](../../handoffs/C03.md)。

## 本机整合

- root全strict（admin/API/测试tsconfig）与build通过；API23文件313项源码测试通过。
- admin新路由整合后36文件344测试通过；独立审查追加Unicode边界修复后LifecyclePage11项通过（含新增3项），整合全量36文件347测试及admin严格类型/build全部通过。
- 全format/diff检查通过；checker/production/fingerprint语法检查通过。
- 010 SHA256 `a4c2394280bee34e89b9b8add078f0a92fc3ab0908859625cda16ed8cb984433`；001–009逐字节对比main909fb74保持不变；10Migration/40表manifest。不扩runtime UPDATE权限。
- 新真实PG17项（生命周期10/私有汇总7）已编写但未本机运行；原真实API scoring两模式浏览器与restart/fullrestore已扩展，待隔离CI。无本机PG/Docker/官方Chromium运行时，不以Mock替代。

## 独立静态审查

`/root/c03_independent_review` 对root最终整合diff判定CLEAR，无未修阻断。核对生命周期event UPDATE与原记分SHARE锁序/CAS/单事务审计、闭赛14类命令和幂等重放守卫、安全release/人员撤权豁免、LIVE/HISTORY用途与永久旧键撤销、OBS独立、单statement确认/名单来源、实际event_staff权限、三元身份、共享名次、hash与UI跨org迟到/409恢复，以及恢复quarantine。

发现并修复：0样本归属标记API/UI不一致、summary响应赛事ID核验、0样本球队不冒充真实零统计、新增第二court后的恢复断言、Unicode原因码点长度一致性。每项修复已由作者/root核对，最终真实运行仍待CI。本结论是静态审查，不是独立PG/浏览器/Docker实测或自动安全扫描。

## 未验证边界

旧001–007升级夹具仍只含旧用户，不是既有FINAL完整赛事升级；原生OBS/CEF、真实手机微信/Safari、生产部署/正式DB/账号均未执行。完整商业版的其他赛制、长期赛季及专业统计、交易支付/退款对账、微信与媒体未由本卡完成。

## 首轮CI（未作为最终通过）

[39938738301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39938738301)，source50beb1a，三个完整job日志已读取。admin成功660源码+12Mock；production成功16真实PG+4可信HTTPS/40表恢复隔离；api新17项均过，但旧P05-B一项错误优先级回归导致185/186，后续API浏览器未跑。修复服务守卫顺序保留旧422 SCHEDULE_REQUIRED，验收断言未改，等待完整重跑。

守卫顺序修复后API strict/313源码/build再次通过，独立静态delta复核CLEAR；首head自动CodeReview completed无finding/security未运行，不代替新head的完整验收。
