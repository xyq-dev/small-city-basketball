# COS01 接续记录

2026-11-06（Asia/Shanghai），负责人及集成人Codex root。状态DONE / MAIN（源码与隔离验收）；真实COS接入尚未配置，本轮功能未部署到生产。

## 代码定位

| 项目 | 核验依据 |
| --- | --- |
| 实施目录 | `/workspace/scratch/1385f4a4fde1/small-city-basketball` |
| 来源分支/仓库 | `feat/tencent-cos-media` / `xyq-dev/small-city-basketball` |
| PR | [#45](https://github.com/xyq-dev/small-city-basketball/pull/45) |
| 最终代码候选 | `a4dff06eedb5815e1cfedc48fe57361b1a527a1a` |
| 候选 tree | `1d8e93fbf6cfac64dd88c3a93828f973ccca5eec` |
| 合并提交 | `98f171f6135b88f7a26ec49f8d63de9fe8dcba10` |
| 合并时间 | `2026-11-06T07:15:29Z`（Asia/Shanghai 15:15:29） |
| 精确CI | [CI211 / run42175621742](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742) |

最终 CI 与审查线程处理记录：

CI211 head为上述a4dff06，admin、api、production、account-security四个作业均SUCCESS，attempt1。集成人及独立复核者均核验完整api日志：PG143及620（含COS9）、原生HTTP21、完整manifest及元数据样本的实际PG重启、真实API浏览器桌面12/手机12、自有资源失败清理均通过，无retry/flaky摘要。管理端598、API源码1374、微信源码1196通过及1项既有平台跳过；CLI12、e2e1349通过/1335配置跳过及1335布局证据。production最小权限21、HTTPS4、完整数据库归档恢复/隔离/自有清理通过；account-security桌面/手机各1及失败清理通过。

root已解决唯一P2线程`PRRT_kwDOVTBG0860ZrAf`，无其它审查线程，独立复审通过。PR45已合并，候选、CI测试merge-ref与合并提交的tree均为`1d8e93fbf6cfac64dd88c3a93828f973ccca5eec`。合并后main自动重复CI不计作已通过的CI211。

CI209、CI210 已取消，不能作为最终验收。初始开发基线为 ef62cb1；期间普通合并 main f7382c3，保留 PR43 账号安全及049原文，COS迁移顺延050。没有 force push 或用旧 COS 迁移覆盖账号安全。

## 已交付的实现

官方 COS SDK 3.0.0 adapter/runtime、三条上传路径、兼容旧DB文件的私有/公开读取、SHA256及Range、持久化对象登记和独立小连接池、后台/CLI清理、恢复隔离、050和权限清单、Docker可选出站模板及配置手册均已纳入候选。恢复工具与API共用纯存储恢复门禁；隔离工具不再为此加载整个Nest App及无关native图像依赖。

文件权限、显式公开发布和撤销行为保持原服务端规则。单文件8MiB、机构128MiB、512KiB分片保留；分片只在完成时写入COS。直播录制/转码大文件、本人加密材料和治理附件未迁往COS。客户端不接触云密钥或绕过撤销的云直链。

清理以云成功回执登记物理删除；暂时失败保留重试。独立审查修复规范机构ID、32/8192登记上限、DB异常整批回滚。自动Review P2指出最旧失败项占满清理批次，现以持久化`cleanup_attempted_at`轮转修复，保留活跃文件/24小时宽限/不可变身份/单调时间和最小列更新权限。该补丁已通过精确CI211与独立复审，线程已解决。

## 验收口径

- PGlite PostgreSQL WASM：完整001—050、旧媒体内容兼容及34项SQL断言通过，见[SQL记录](../evidence/COS01/sql-check.txt)。这不等同原生连接并发。
- 原生PostgreSQL：COS9项HTTP/事务集成已在CI211通过，包含并发幂等、上传与清理互斥、并发清理、PUT后事务回滚，以及20失败对象不能阻塞另一机构第21对象。
- CI211还通过相应旧业务PG、原生页面/API、最小运行权限、PG重启、隔离镜像/HTTPS、全库归档恢复及凭据隔离。精确通过数字和作业状态见[验收记录](../evidence/COS01/README.md)，不复用旧候选结果。

## 尚待外部验证

未创建付费资源，未配置正式COS/CAM凭据，未向正式环境发布应用或执行Migration。050仅在隔离环境执行；真实COS读写/删除、CAM最小权限、桶版本控制门禁、云对象独立备份恢复、微信真机及生产环境尚未验收。隔离production作业的镜像和HTTPS验证不代表正式主机部署。

正式有COS文件后不能直接切回数据库配置或旧程序，否则云文件会不可读。数据库dump不含COS字节，不得将只恢复数据库记为完成媒体恢复。专用桶必须私有且从未启用版本控制；配置、出站网络、最小权限和恢复边界以[运行手册](../operations/tencent-cos.md)为准。

## 下一位执行者的第一条操作

先读取本页、[任务卡](../tasks/COS01.md)、[验收记录](../evidence/COS01/README.md)，核验当前远端main包含上述合并提交，检查并保留后续工作区修改；以记录的精确CI211为源码验收依据，不把合并后自动重复CI当成已通过的新证据。

源码已合入main；下一步使用独立测试桶和隔离数据库按运行手册验证实际上传、完整性、下载/Range、权限、撤销、失败清理及云对象恢复，再据明确的正式部署范围安排050和应用上线。真实云条件未提供时，报告具体缺口，不重复运行已通过的无关源码测试，不把外部待验伪装成源码缺失。
