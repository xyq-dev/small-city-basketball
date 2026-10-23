# C04 独立静态审查

2026-10-23（Asia/Shanghai），审查人 c04_browser。结论：当前已审阅整合快照未发现未修复的确定 P1/P2；曾发现的 FINAL 人员安全维护与晋级来源版本耦合问题，已在 root 最新代码静态复核修复。真实 PostgreSQL、浏览器、CI、生产结果不由本审查代替。

## 独立范围

本人只实现新浏览器测试驱动，没有实施本次审查的后端。先读取各作者工作树候选，再对 root `/workspace/scratch/dc6a786e1a31/small-city-basketball` 实际整合文件作 delta 复核。root 基线为 C04 合同卡提交 `4b489973ce3937f860d4053130e8abe6e598c275`；下列是工作区内容快照哈希，不冒充最终 Git 提交或未来未改变代码。

| 文件 | SHA-256 |
|---|---|
| `apps/api/migrations/011_c04_knockout.sql` | `23027d473167ae319b826b3bc2167baea7d59e548f7e75b58294db5ddbcccce3` |
| `apps/api/src/knockout-domain.ts` | `f5021c21e02f90335ad9eb740f8fae1c5d8f6ca071de83f50c7eddb307e252fe` |
| `apps/api/src/knockout-service.ts` | `d03887907c1d1577735c108f25b8254a78dd1401b8f2f0aff9a823e8ca522ce8` |
| `apps/api/src/scheduling-service.ts` | `93746fb4c1ba8d55c90ac95fabcaf53fac95bfe35a95d23843dfad7b39dbac38` |
| `apps/api/src/scoring-service.ts` | `0b0dbfaba6ba3e519f4b972a462550fdb9f538ed68bb5e3dad0fe0bffeec6474` |
| `apps/api/src/standings-service.ts` | `786ca94d741e5b078becb5a2914af4922b9a5351acb2e83afd5925753765c674` |
| `apps/api/src/event-lifecycle-service.ts` | `f2c046bbd0a1aa090f32632ad795e3ec0f8765769f16aed67290f1d3de6a4ffb` |
| `apps/api/src/event-lifecycle-domain.ts` | `d91bf525cde909e20fe184a14ad12b0a43d0dba6629338d01a86856fa5eff636` |
| `apps/api/src/event-player-statistics-service.ts` | `a57b8538da0a03238cf74e9ad4564fff3672c4538d8c2c9ae09b9b16480bc475` |
| `apps/api/src/event-player-statistics-domain.ts` | `ed3f7030046d9b05ec12b5c7de70932529cf15fab006402ee0f542dd1f57a09d` |

重点审查了：011 原 RR 分支不放宽、新 SE 完整轮次凭证/创建事务绑定/非空值/FK 租户边界/迟延完整性；组织排赛 mutex→赛事 UPDATE 与记分事件 SHARE 的序列化；固定签位、首轮轮空、来源确认与版本、跳轮/半轮拒绝、最终共享名次；公开规则为空仅限 SE、opaque 白名单、后轮撤销旧 LIVE、历史/OBS 授权边界；球员榜一条 statement 读取与整届 n−1 分母；改期不得早于已确认父赛结束。

## 已修复问题与复核

### P1：FINAL 后合法人员维护使已晋级来源永久失配

早期候选以 `published_matches.version` 作为不可变晋级 `sources.matchVersion`，SQL 同时强制确认产生版本等于当前比赛版本。原 `ScoringService.updateMatchStaff` 合法允许 FINAL 后人员停用/维护，并只递增比赛及状态来源版本、保留原独立确认。因此：晋级前安全停用会令下一轮发布触发23514；晋级后安全停用会使纯域当前来源和已发布凭证失配，导致 bracket/公开/球员榜/完赛核对报 `RESULT_SOURCE_INVALID`，而该源比赛已被消费不能重开修复。

root 最新整套修复已重新实读：

- 纯域 `sources.matchVersion` 固定为 `confirmedResult.sourceMatchVersion + 1`，表示确认生效版本，不使用人员维护后的当前版本。
- SQL `c04_round_insert_guard` 将该字段与确认生效版本精确比较，并允许它小于或等于当前比赛版本；`scoring_states.source_version` 仍必须等于当前比赛版本，最新确认 ID、FINAL、非平分、事件序列/来源和胜者检查保留。
- 新 PG 五队主链已编写晋级前/后人员维护断言；域单测亦有稳定确认来源回归。这里只确认实际代码存在且逻辑对应修复，不称 PG 已执行通过。

状态：FIXED（静态复核）；不是未解决 finding。

## 其他复核结论

- 公开 `rules=null` 仅 SE 格式接受；公开页面先读格式后选择 bracket，不向 SE 请求循环赛积分。RR public event 仍省略新 format 字段，保持原严格 DTO 兼容。
- 新轮显式发布持赛事 UPDATE，所有计分写先持赛事 SHARE/UPDATE，确认读取和 consumed 重开守卫与发布串行；来源一经引用禁止重开含命令重放。公开撤销和新增整轮、版本及审计位于同一事务。
- 轮空仅来源、不生成虚拟比赛；完整树域校验实际已发布轮次、冻结双方与名单、当前独立确认和每轮来源。最终名次只在全部 n−1 真实比赛确认后产生。
- 公开输出只显式构建 teamKey/publicMatchId、球队名称、签位、计分与名次；未复制私有 seed/成员/原始来源或写入凭据。现有 OBS 独立授权没有继承公开观赛权限。
- UI 只读核查时曾发现两个签位 div 仅 aria-label 不构成 region；已通知 UI 作者并确认加上 role=region。最终名次 section 的可访问性正确。此项已修，不放宽真实浏览器 selector。

## 实测边界与下一步

本轮审查未启动数据库或浏览器，没有执行 Migration、生产发布或账号维护。测试驱动本机 Prettier 与测试 strict 编译通过，不能据此称真实功能验收通过。root 必须对最终精确候选运行完整源码/真实隔离 PG/桌面和手机模拟/可信 HTTPS/实际重启与完整恢复 CI，并核对所有 job 日志；若后续源码变化影响上述路径需做必要 delta 复核。
