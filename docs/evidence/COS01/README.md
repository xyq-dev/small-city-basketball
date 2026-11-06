# COS01 验收记录

2026-11-06（Asia/Shanghai）。状态DONE / MAIN（源码与隔离验收）。本记录区分本地源码/WASM SQL、原生隔离CI和正式外部环境；源码验收不代表已接通真实COS或完成生产部署。

## 精确代码与CI

| 项目 | 依据 |
| --- | --- |
| 仓库/来源分支 | `xyq-dev/small-city-basketball` / `feat/tencent-cos-media` |
| PR | [#45](https://github.com/xyq-dev/small-city-basketball/pull/45) |
| 最终代码候选 | `a4dff06eedb5815e1cfedc48fe57361b1a527a1a` |
| 候选tree | `1d8e93fbf6cfac64dd88c3a93828f973ccca5eec` |
| 最终合并提交 | `98f171f6135b88f7a26ec49f8d63de9fe8dcba10` |
| 合并时间 | `2026-11-06T07:15:29Z`（Asia/Shanghai 15:15:29） |
| 最终候选工作流 | [CI211 / run42175621742](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742) |

四个作业、完整日志、精确测试数字和自动审查线程的最终核验：

CI211 head为`a4dff06eedb5815e1cfedc48fe57361b1a527a1a`，attempt1，四个作业均SUCCESS。root及独立复核者均已核验完整api日志；未见retry/flaky摘要。精确结果如下。

| 作业 | 已核验结果 |
| --- | --- |
| [admin](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742/job/127753687885) | 管理端598、API源码1374、微信源码1196通过，1项既有平台跳过；CLI12通过；e2e1349通过、1335项按配置跳过，1335份布局证据 |
| [api](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742/job/127753688170) | PG两组143及620通过，620组内含COS9；原生HTTP21、实际PG重启的完整manifest及元数据样本、真实API浏览器桌面12/手机12、自有资源失败清理通过 |
| [production](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742/job/127753688197) | 最小权限PG21、HTTPS4、完整数据库归档恢复、恢复凭据隔离及自有资源清理通过 |
| [account-security](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742/job/127753688242) | 桌面/手机各1、失败清理通过 |

PR45于上述时间合并；候选、CI测试merge-ref和合并提交的tree完全一致，均为`1d8e93fbf6cfac64dd88c3a93828f973ccca5eec`。独立复审通过，root已解决唯一P2线程`PRRT_kwDOVTBG0860ZrAf`，无其它审查线程。合并后main自动重复CI不计作已通过的CI211。

CI209、CI210已经取消。它们的部分成功和旧候选测试只解释迭代历史，不作为CI211或合并结果的通过证据；不得将不同候选的成功作业拼成一次完整验收。

## 验证层次与覆盖

| 层次 | 实际范围 | 结论来源 |
| --- | --- | --- |
| 源码 | 官方SDK 3.0.0 adapter、配置、字节/摘要、持久化边界、限额、失败轮转、CLI/恢复门禁；类型、格式、构建和相关恢复打包检查 | 本地与CI211通过，精确数字见上表 |
| WASM SQL | PGlite PostgreSQL 18.6 WASM隔离库，完整001—050与34项SQL断言；049媒体字节/摘要在050后保持原样 | [完整SQL执行记录](sql-check.txt)与[SQL验收](../../../apps/api/test/cos-storage.sql)；已通过，不替代原生并发 |
| 原生COS HTTP/事务 | PostgreSQL多连接、真实API和可控字节传输替身，共9项 | [集成源码](../../../apps/api/test/cos-media.integration.test.ts)；CI211 api作业通过 |
| 隔离运行与恢复 | 既有业务PG、原生页面/API、最小权限、实际PG重启、镜像/HTTPS、数据库归档恢复、旧凭据隔离及仅自有资源清理 | CI211对应api/production及其它作业完整日志 |
| 正式外部环境 | 真实COS/CAM、微信真机、云文件备份恢复、本轮生产COS功能 | COS尚未配置，本轮功能未部署，相关联调未验收 |

原生COS的9项用例分别覆盖：旧DB文件和规范UUID路由；幂等回放与分片完成；相同请求实际并发时201/200且只有一份文件/登记/对象；老化上传登记持锁时清理不误删；并发清理只物理删除一次；PUT成功后DB回滚仍保留可回收登记；草稿私有、发布/Range、撤销和重试删除；PUT失败保留孤儿；20条旧失败不阻止另一机构第21条对象推进。传输替身只证明应用与数据库的行为，不证明腾讯云账号、CAM策略、网络或存储桶已配置。

## 审查修复

独立审查修复大写机构UUID、失败登记32/8192硬上限和清理DB异常传播。自动Code Review随后提出P2 `PRRT_kwDOVTBG0860ZrAf`：最早一批持续删除失败可能占满后续清理批次。

修复将失败尝试时间写入`cleanup_attempted_at`，按未尝试优先、最早失败时间轮转；不把失败误记为`deleted_at`。SQL限制仅符合清理资格的记录可推进，时间不能倒退或写未来，终态不可改；runtime只增加这一列的UPDATE权限。资格谓词、行锁/`SKIP LOCKED`和取得锁后的活跃引用复核保持不变。DB更新失败向外传播并整批ROLLBACK。新增第9项原生跨机构回归与WASM SQL边界断言；最终独立复审和精确CI211均通过，root已解决该唯一P2线程。

## Migration与上线边界

050已编写并仅在隔离环境执行；001—049保留main原文，049账号安全不变。静态清单为50项Migration、223张表、128个函数。没有执行生产Migration或正式部署，没有创建付费COS资源或配置正式凭据。

保留8MiB单文件、128MiB机构共享和512KiB分片限制。此次未迁移直播数据卷、本人加密资料或治理附件，未交付大视频直传或云点播。数据库备份只保存对象引用；真实云对象的独立备份、恢复和校验必须另行验收。外部接入条件与后续步骤见[运行手册](../../operations/tencent-cos.md)及[接续记录](../../handoffs/COS01.md)。
