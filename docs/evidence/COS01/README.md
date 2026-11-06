# COS01 本地验证证据

2026-11-06 Asia/Shanghai。工作分支 `feat/tencent-cos-media`，初始基线ef62cb1、初始提交4170765已共享至PR45。当前整合main f7382c3后将COS迁移顺延050；下方1366项为初始本地测试，新的原生CI结果待补。未部署，以下不作为远端CI或线上通过证据。

- Node v24.22.1、npm 11.9.0；`npm ci --ignore-scripts`及官方COS SDK 3.0.0精确版本安装成功，锁文件同步。
- `npm test --workspace @small-city-basketball/api` 最终120个文件、1366项全部通过（46.52s）。COS相关测试仅使用传输替身，没有访问真实云资源。
- `npm run typecheck --workspace @small-city-basketball/api` 与 `npm run build --workspace @small-city-basketball/api` 通过。新HTTP集成文件只完成类型检查，尚未连接原生数据库执行。
- `npx prettier --check` 对本轮所有变更TS/JSON/YAML通过，`git diff --check`通过。没有以API测试代替微信真机或其它业务验收。
- [完整SQL执行记录](sql-check.txt)：在临时PGlite PostgreSQL 18.6 WASM引擎、独立 `scb_test_cos_schema` 库，按实际001—050执行，加载既有合成legacy-007业务fixture；049时写入DB媒体字节，050后确认payload/摘要与空COS引用保持原样。随后运行[21项SQL约束](../../../apps/api/test/cos-storage.sql)，覆盖双源一致性、跨机构、不可变引用、删除保护、24小时宽限与共享配额，全部通过，测试数据ROLLBACK。
- 原生PostgreSQL和Docker在本容器不可用；原生包安装遭容器身份权限限制，未升级权限。WASM SQL验证不等于TCP多连接事务/并发、原生运行权限或重启恢复验收。
- 独立审查与复审：修复规范机构UUID、失败登记上限和清理DB异常处理后，无阻止本地代码交付的发现。仍需原生PG、正式SDK/CAM/桶版本控制、真实COS上传/读取/删除及微信真机验证。

Migration状态：050已编写、隔离WASM执行；001—049沿用最新main原文；生产未执行。运行时清单为50项Migration、223表、128函数，静态一致性检查通过。数据库dump不包含COS文件字节，云对象备份恢复另行验收。
