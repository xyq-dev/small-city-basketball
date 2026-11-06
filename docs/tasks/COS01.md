# COS01 腾讯云 COS 媒体存储

- 状态：DONE / MAIN（源码与隔离验收）；正式COS接通和生产上线另行验收。
- 负责人/集成人：Codex root；日期：2026-11-06（Asia/Shanghai）。
- 实施目录：`/workspace/scratch/1385f4a4fde1/small-city-basketball`；来源分支：`feat/tencent-cos-media`；已集成`main`。
- 仓库：`https://github.com/xyq-dev/small-city-basketball.git`；[PR #45](https://github.com/xyq-dev/small-city-basketball/pull/45)。
- 最终代码候选：`a4dff06eedb5815e1cfedc48fe57361b1a527a1a`；tree：`1d8e93fbf6cfac64dd88c3a93828f973ccca5eec`。
- 合并提交：`98f171f6135b88f7a26ec49f8d63de9fe8dcba10`；合并时间：`2026-11-06T07:15:29Z`（Asia/Shanghai 15:15:29）。合并、候选和CI测试merge-ref的tree完全一致。

## 目标与交付范围

保持现有页面与媒体API，将现有媒体接口接收的图片和小视频的新文件内容保存到私有COS，数据库保留文件元数据与不可变对象引用。旧PostgreSQL文件继续读取；普通上传、幂等上传和分片完成三条路径使用同一存储边界。读取仍先核验身份、机构、资源及公开发布权限，再校验云文件长度和SHA256，沿用原Range响应；不向客户端下发云密钥或绕过撤销的长期云链接。

保留单文件 **8MiB**、机构共享 **128MiB** 和 **512KiB** 分片限制。分片暂存数据库，完成校验后写 COS 并释放；本卡不包括大视频直传、CDN、云点播，以及直播录制数据卷、本人加密资料或治理附件的迁移。

本轮可执行代码提交、普通推送、PR、隔离 CI，以及审查和验证通过后的 main 合并。未创建付费资源，未配置正式 COS/CAM 凭据，未向正式环境发布应用或执行 Migration。定位、UI、支付、投保和记分规则不在本卡改动范围。

## 数据、失败与恢复边界

- 官方 `cos-nodejs-sdk-v5` 固定为 3.0.0；默认使用数据库存储。显式选择 COS 后配置或云操作失败即返回错误，不悄悄回退数据库。
- 新增 `050_cos_media_storage.sql`、`media_cos_objects` 与 `media_files.cos_object_id`。实施中普通合并保留 main `f7382c319c0e11b867b9f07c584ed135496f01ec` 的账号安全成果，001—049 不变，049 未被 COS 覆盖。当前静态清单为 50 项 Migration、223 张表、128 个函数。
- 上传先完成权限、格式、摘要与配额核验，再通过独立小连接池提交对象登记。业务事务持登记行锁上传并关联文件；事务回滚或上传结果未知时，登记仍保留，孤儿超过 24 小时才可清理。
- 失败登记受每机构 32 条未关联待处理、8192 条总登记上限约束。超限返回 `409 MEDIA_STORAGE_LIMIT`，不继续登记或写 COS。
- 撤销关闭业务访问；明确清除后释放业务额度，后台或 CLI 删除云对象。只有 COS 确认删除后才写 `deleted_at`。失败写入受约束的 `cleanup_attempted_at`，候选优先选择未尝试、再按最早尝试排序，避免持续失败的一批阻塞其它机构。数据库异常整批回滚，不当成单个 COS 失败吞掉。
- 清理保持资格检查、`FOR UPDATE ... SKIP LOCKED` 和取得锁后的活跃引用复核。恢复隔离不初始化 COS adapter，不读取云凭据，也不执行云读写或清理。数据库备份只包含对象引用，云文件备份恢复仍需独立验收。

运行配置、专用私有桶和最小权限要求见[腾讯云 COS 手册](../operations/tencent-cos.md)。

## 审查与验收

独立审查已修复并复核：大写 UUID 路由规范化、失败登记有界、清理数据库异常传播。自动 Code Review 随后指出 P2 清理队列饥饿，线程 `PRRT_kwDOVTBG0860ZrAf`；已补持久化失败轮转、单调且非未来的失败时间保护、最小列更新权限和跨机构队列回归。最终独立复审通过；root在本补丁及精确候选验收通过后解决该唯一P2线程，无其它审查线程。

| 验证层次 | 范围与证据边界 |
| --- | --- |
| 源码验证 | 本地及CI类型/格式、构建和相关恢复打包检查通过；CI211管理端598、API源码1374、微信源码1196通过，1项既有平台跳过 |
| WASM SQL | 完整001—050、旧媒体字节兼容及34项SQL断言通过；属于PGlite隔离验证，不替代多连接并发 |
| 原生 PostgreSQL COS | CI211 api作业通过，PG两组143与620，620组内含COS9；9项覆盖旧文件、三上传路径、权限、发布/Range/撤销、真实连接并发、回滚登记和跨机构队列推进 |
| 隔离环境与恢复 | 原生HTTP21、实际PG重启完整manifest及元数据样本、真实API浏览器桌面12/手机12通过；production最小权限21、HTTPS4、完整数据库归档恢复和凭据隔离通过 |
| 正式外部环境 | 真实COS/CAM权限、微信真机、云对象备份恢复和生产上线尚未验收 |

精确候选 [CI211 / run42175621742](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742)：

head为`a4dff06eedb5815e1cfedc48fe57361b1a527a1a`，四个作业admin、api、production、account-security均为SUCCESS，attempt1。集成人和独立复核者均已核验完整api日志，PG、原生HTTP、实际重启、真实API浏览器及自有资源失败清理通过，未见retry/flaky摘要。admin另有CLI12、e2e1349通过/1335配置跳过及1335份布局证据；account-security桌面/手机各1与失败清理通过。完整数字和分层边界见[验收记录](../evidence/COS01/README.md)。合并后main自动重复CI不计作已通过的CI211。

CI209、CI210 已取消，只保留为迭代历史，不作为最终候选的成功证据；不能拼接旧候选作业结果代替本候选四个作业的完整验收。完整来源见[验收记录](../evidence/COS01/README.md)。

## 交接

代码、050和配置模板已随PR45合入main，合并tree与精确候选一致。050只在隔离环境执行，生产未执行；本卡的源码验收与真实COS接通、正式部署分别记录。

下一位执行者先核验当前main是否仍包含上述合并提交，保留并发改动，再按[接续记录](../handoffs/COS01.md)处理独立测试桶联调和正式部署条件。正式资源或凭据未就绪时，明确保持外部待验，不将已有源码或隔离CI写成线上完成。
