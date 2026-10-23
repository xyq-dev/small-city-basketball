# C02 008统计与009账号维护独立静态审查

2026-10-23（Asia/Shanghai）；审查人：validation_runtime。只读审查、向作者反馈并复查修复，没有修改业务源码或Migration。

## 范围与结论

审查 `/workspace/scratch/dc6a786e1a31/c02-stats` 的008、原计分事件/投影/确认扩展，以及 `c02-auth` 的009、兼容登录与离线维护CLI。基线1534216，本轮改动未提交。

**当前审阅源码范围未发现未解决的阻断问题。此结论是静态审查与独立源码用例结果，不是PG、浏览器、生产或完整商业版验收通过。** 008/009均只编写，真实PG执行仍待可用隔离环境。

## 发现及处理

### 1. 账号维护与新会话请求的三方死锁窗口（P2，已静态修复）

原实现先枚举并锁定旧sessions，再锁user，最后UPDATE全部sessions。可构造：旧密码login在session枚举语句快照后创建新S1并提交；维护取得user UPDATE；新请求先锁S1 SHARE再等待user SHARE；维护反过来等待S1以撤销，形成锁环。原inflight用例没有同时使用新S1访问受保护接口，未覆盖该窗口。

作者修复为login在事务内取得用户级共享advisory锁，维护在session枚举前取得同key独占advisory锁；已有login必须先完成，维护期间不能生成漏枚举的新session，session→user的既有请求锁序保持。候选user在锁下再次核验旧hash、alias、email、status，失败整体回滚。已补使用user行锁与维护UPDATE gate的三方PG用例，**该PG用例尚未执行**。

### 2. CLI“私有DB文件”缺少实际文件边界（已修复）

原DB_URL_FILE使用通用reader，只检查变量与长度，未检查文件权限/owner/no-follow。现维护CLI的输入与DB URL均通过同一严格有界文件reader：普通文件、0400/0600、当前进程owner、O_NOFOLLOW、有限读取，拒绝argv/inline凭据；CLI只输出固定错误及非秘密结果。维护限定scb_admin/scb_migrator或DBsuperuser；API runtime不扩UPDATE users权限。

### 3. 确认球员JSON直接透传及来源一致性（已修复）

`confirmation()`新增字段原直接返回存储JSON。作者已改为白名单重建、模式/计数/球员ID/姓名号码检查，个人+未归属统计须等于确认球队分/犯规。FINAL且不待重确认时，当前有效确认的个人统计须等于原事件重放投影；确认历史继续不可变。

额外统一UUID小写后去重（包括跨侧），姓名1–80 codepoints且无NUL；坏来源不会当成真实0统计。

## 保留的核心性质

- 旧省略memberId/collectionMode的命令不会补null/default字段，旧hash和prepare事件保持原表示；旧状态/确认默认TEAM_ONLY、player_stats SQLNULL。
- 成员来源是published_matches中既有的不可变报名revision，按org/entry/revision读取白名单；错误侧/未知球员归属被拒绝。
- 同一计分事件重放派生球队和个人投影，没有第二套写入比分/时钟；更正、收据、版本、确认、审计继续同事务。
- 008替换state guard时保留原源身份与单调版本条件，并新增模式不可变；旧历史表guard不放宽。
- 私有workbench名单沿既有实际赛事工作人员/本场授权；报名服务原已向实际event_staff开放相同memberId/name/jerseyNo，故未发现新增公共主体。匿名/OBS DTO不扩个人字段。
- 009用户名为可空、规范小写ASCII、唯一，原email及角色保留；登录不按admin字符串授予权限。
- 维护不重建目标用户/机构，系统审计actor是无机构权限、不可登录的DISABLED主体；凭据修改、会话撤销及审计一起提交或回滚。

## 本代理独立执行的源码检查

- stats：`npx vitest run src/player-statistics.test.ts --maxWorkers=1`，8/8通过。
- auth：`npx vitest run src/account-maintenance.test.ts src/validation.test.ts --maxWorkers=1`，21/21通过。
- 两个worktree的`git diff --check`均通过。
- 不把作者的全量源码/类型报告计为本代理实测；没有执行真实PG或浏览器。

## 审阅快照 SHA-256

| worktree / 文件 | SHA-256 |
| --- | --- |
| c02-stats / apps/api/src/player-statistics.ts | bdf35c768cf3f0831fdbcd5cac6ee369d12b2604eb98391f6e6fbbaeffcdaf0b |
| c02-stats / apps/api/src/scoring-domain.ts | be7290d717a89349884ac6c4544f21537ecc153c2463a6d5c15ce34af51c3fb0 |
| c02-stats / apps/api/src/scoring-service.ts | 447ee7ef91a922a76a7ebcf08d4822180eb063c047fb3a8a73826e6bace79760 |
| c02-stats / apps/api/migrations/008_p05_player_statistics.sql | ae37ffcfcdf16b697513212b2404eaafde8968e095d163c3259689a86f23815b |
| c02-auth / apps/api/src/account-maintenance.ts | f5db11950e21a59bec5c038fcad0297abdd0afd87038f44b7129a9f7b7aad1ba |
| c02-auth / apps/api/src/service.ts | 5c90b86e0c7bceb46570f007c5242e05ae6c713884f84228480154d69864afe8 |
| c02-auth / apps/api/src/validation.ts | f627040d5d61baf346fcefbd444762042e1c9f07614b1c4c96b1ba2af937ec19 |
| c02-auth / apps/api/migrations/009_c02_login_names.sql | 36f7f2b3e30caa8e51343926581b758709dc1c4a9673de6907f4a2d2f0d63ea8 |

后续整合引入源码增量时按实际差异复查；runtime manifest、Migration数、恢复指纹及真实PG并发/约束/rollback属于集成人待完成验证，不因本记录自动通过。
