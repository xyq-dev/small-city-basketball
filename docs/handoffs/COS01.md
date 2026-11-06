# COS01 接续记录

最新修复检查点：自动Code Review对8237f49指出清理队列饥饿P2（PRRT_kwDOVTBG0860ZrAf），已在本地补持久化失败尝试轮转、单调时间/资格保护、最小列权限与第9项跨机构原生PG回归。API1374项、全仓类型、PGlite完整001—050和34项SQL约束、独立复审通过；新候选待同步并重新四job CI。旧CI210结果仅表示旧候选，不可据其合并新代码。审查线程在新补丁与验收通过后解决。

当前执行检查点（2026-11-06）：PR45已转正式评审，最终代码候选8237f4961f6b80ea17edc97e42146d8b3be785d6，tree dc65ddeb0014d2b12ebd4298ccb0ee65ece08d72。[CI210](https://github.com/xyq-dev/small-city-basketball/actions/runs/42173048311)四job中admin/account-security/production已SUCCESS，已读取三个完成日志：管理端598、API源码1373、兼容浏览器1349通过/1335配置跳过；账号安全桌面/手机各1、owned DB清理通过；生产隔离最小权限21、HTTPS4、完整备份恢复/凭据隔离/owned清理通过。api job ID127745575220仍在Existing PostgreSQL integration checks；Remaining modules已通过。合并必须等这一精确候选api余下PG/重启/浏览器和最终四job全绿，不能把当前三项成功当成完成。最终复审无代码阻断；未部署、未真实COS。本文检查点暂留本地，避免仅写状态触发正在运行的CI重跑，结束后随文档收口同步。

2026-11-06 Asia/Shanghai，负责人 Codex root。状态 REVIEW / BRANCH_ONLY，基线与授权见[任务卡](../tasks/COS01.md)。

最新检查点：初始提交4170765已推送[PR45](https://github.com/xyq-dev/small-city-basketball/pull/45)。main发布期间更新至f7382c3，已普通merge并保留PR43账号安全；049_first_run_setup保持原文，COS改为050_cos_media_storage.sql、guard c50，清单50迁移/223表/128函数。新基线PGlite完整001—050及21项约束通过，原生CI等待后续整合候选。下方旧049/LOCAL_ONLY记录仅表示初始本地检查点。

7394730的CI209开始运行，account-security已成功；之后增加纯存储`forRuntime`工厂，API与隔离工具复用同一恢复门禁，工具不再加载整个App/sharp。定向15项、类型/构建/格式/打包与实际编译模块加载验证通过。后续以新提交的完整四job CI验收，不混用7394730旧结果。

接续授权更新：用户已同意独立分支提交/推送、PR、GitHub CI及验证审查通过后合并main。当前正在补并发验收并准备共享；下方“未提交/原生PG未验”为此前检查点，实际Git与CI完成后再更新。真实COS配置、付费资源和生产迁移/部署未由本轮启用。

提交候选补充：COS原生PG集成现有8项（新增4项并发/SQL回滚），以及新表非空metadata-only恢复fixture。新的helper进入Docker构建白名单/COPY与production脚本摘要清单，不访问真实COS；恢复打包12项、本地格式/类型及49迁移静态门禁通过。原生PG并发与完整隔离HTTPS/恢复验收交由本次PR的精确候选CI执行。

已完成：实际clone并核验 main ef62cb1，建立本地 `feat/tencent-cos-media`；读取媒体整体/幂等/分片、发布、私有读取、本人资料共享配额和恢复隔离路径，确定私有COS和持久化清理登记方案。npm ci已完成。

完成：COS adapter/runtime、3条上传路径、兼容旧文件的私有/公开读取、SHA256/Range、持久化清理登记/独立小连接池、后台/CLI清理、恢复隔离、049/权限、配置模板和手册。独立复审通过；最终API单测1366/1366、类型/构建/格式通过，PGlite完整001—049、旧字节兼容与21项SQL约束通过。详见[证据](../evidence/COS01/README.md)。

仍未验证：原生PG多连接并发与新HTTP集成（测试已编写），真实COS/CAM、真机和生产。未执行commit/push/pack/部署/生产Migration，未创建付费资源或配置正式凭据。现有单文件8MiB/机构128MiB限制保留；直播大文件和本人加密材料没有迁往COS。

下一位执行者第一步：核验此checkout分支和未提交diff，保留全部本轮改动；在原生隔离scb_test_*库运行 `npx vitest run test/cos-media.integration.test.ts test/c05-media.integration.test.ts test/c19-media-requests.integration.test.ts`（工作目录apps/api，TEST_DATABASE_URL只通过私有环境配置），并检查跨连接事务/最小运行权限。随后按[配置手册](../operations/tencent-cos.md)准备独立测试桶及受限凭据做真实联调。
