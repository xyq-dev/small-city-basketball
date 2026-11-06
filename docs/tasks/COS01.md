# COS01 腾讯云 COS 媒体存储

- 状态：REVIEW（分支候选等待原生CI，外部联调待验）；integration：BRANCH_ONLY。
- 负责人/集成人：本轮 Codex root；日期：2026-11-06 Asia/Shanghai。
- 工作目录：`/workspace/scratch/1385f4a4fde1/small-city-basketball`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`；基线：`ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`。
- 分支：`feat/tencent-cos-media`；开始时工作区干净。独立审查/实现使用独立 worktree。
- 本轮授权：设计、开发、隔离测试。2026-11-06用户针对“独立分支提交推送、GitHub CI、原生PG集成/并发/权限验收，通过后合并main”回复“好的”，现继续本任务commit、普通push、PR、隔离CI及通过审查后的合并。真实COS配置和生产上线是后续阶段；本轮不创建付费资源、不配置正式凭据、不部署、不运行生产Migration。

## 交付范围

保持现有页面和上传 API，服务端完成身份/机构/资源权限、格式、摘要和配额校验后，将新文件写入私有 COS。数据库存元数据和不可变对象引用；旧 PostgreSQL 文件保持兼容。所有读取仍经过原权限接口，支持 Range，不向前端暴露云凭据或可绕过撤销的长期地址。分片仍按原有有界协议处理，不将本轮包装成大视频直传或云点播。

允许路径：媒体服务与 COS adapter/runtime/清理任务、追加050 Migration、相关本人资料共享配额查询、运行时权限清单、依赖锁、配置模板、针对性测试、API/数据设计说明及本任务记录。接续补充允许：COS合成恢复fixture及必要Docker打包清单，保证新增表非空重启/归档恢复验收；只在隔离CI验证镜像，不创建发布包或部署。禁止无关 UI、定位、支付、投保、记分规则改动；001—049 Migration 保持不变，049账号安全沿用新main原文。

## 数据与失败处理设计

新增 `media_cos_objects` 保存由服务端生成的对象定位和清理状态；新 `media_files.cos_object_id` 指向相同机构、相同文件ID的登记。上传前通过独立连接持久化待清理登记，在业务事务锁定该登记后上传并关联文件；业务回滚、超时或进程退出遗留的对象可在宽限期后重试清理。清除文件先关闭业务访问、释放业务配额，后台重试删除 COS；清理成功才登记删除时间。恢复隔离禁止 COS 网络读写和清理。

## 验收计划

1. SDK adapter 配置、对象键、私有ACL、错误脱敏与字节/摘要验证。
2. 旧DB文件、整体上传、幂等上传及分片完成均兼容；云文件不会在DB保留完整payload。
3. 跨机构隔离、草稿不公开、发布/撤销、Range及清理失败重试。
4. 追加 Migration、旧数据兼容、最小权限清单；仅在自建隔离测试库执行。
5. API类型检查、受影响单测/PG集成、相关格式与构建；正式COS和真机未有凭据时明确未验证。

## 检查点

- 2026-11-06基线更新：初始35文件已提交417076550fa4fc4aa7de636c3a86b7a81c6203a0并推送，创建[PR45](https://github.com/xyq-dev/small-city-basketball/pull/45)。发布期间main已前进到f7382c319c0e11b867b9f07c584ed135496f01ec（含PR43账号安全），通过普通merge保留新增功能，解决3份文档冲突；COS迁移顺延050、guard为c50_cos_object_guard、readiness为50。无force push、未改049_first_run_setup原文。新基线PGlite完整001—050、旧文件字节与21项约束已重跑通过，静态50迁移/223表/128函数一致；原生CI待整合候选。
- 新基线本地复验：全仓格式与类型检查通过；API源码122文件、1372项全部通过（52.16s）。新增原生PG并发与完整隔离恢复尚等待PR精确候选CI。
- CI209启动后，复核移除恢复工具对完整Nest App的无关native图像依赖：API和工具共同使用纯`MediaObjectStorage.forRuntime`门禁，恢复时配置工厂也不执行。新增回归、定向15项、类型/构建/格式与打包检查通过，编译门禁实际加载未引入sharp。CI209已完成account-security，其它仍在运行；本补丁同步后以新的精确候选CI为准，不沿用旧候选成功。
- 自动Code Review对8237f49提出P2 PRRT_kwDOVTBG0860ZrAf：最早一批持续删除失败会饿死后续对象。已新增受约束cleanup_attempted_at与最小UPDATE列权限、失败后持久化轮转；DB记录异常仍整批回滚。补第9项跨机构原生PG回归（20失败+第21成功）及失败时间/资格/排序SQL，PGlite34项、API122文件1374项、全仓类型和独立复审通过。050尚未合并/生产执行，允许此次修订；001—049不变。新候选同步后需重跑四job，旧CI210的三job成功及现有PG组通过不混作新候选验收。
- 2026-11-06接续：核验分支、HEAD、全部本轮未提交文件和远端main仍为ef62cb1；无其它任务改动。准备补原生PG并发用例、提交独立分支并创建PR，后续CI结果另记，不提前把本地验证记为CI通过。
- 2026-11-06提交前：补齐4项原生PG并发/SQL回滚测试（COS集成共8项）；修复新增表在现有全表恢复非空门禁中缺样本的确定CI阻断，新增metadata-only恢复fixture及capture/verify/freeze/quarantine接线与必要镜像清单。全仓格式/类型、针对性格式/类型、12项恢复/打包测试、49迁移静态清单通过；这些新增原生执行场景等待精确候选CI，不宣称已经通过。
- 2026-11-06：已核验仓库、基线、工作区和现有权限/上传/恢复边界，读取CURRENT_STATUS、TASKS、COLLABORATION。现有媒体限额为8MiB/文件、128MiB/机构，本轮保留。
- 2026-11-06：完成官方SDK 3.0.0 adapter、COS配置与Docker可选出站模板、普通/幂等/分片上传、旧文件与Range读取、独立登记池、后台和CLI清理、恢复隔离、049与权限清单。补齐API/数据模型和运行手册。
- 独立审查发现并修复：大写UUID路由使用规范机构ID、失败登记32/8192硬上限、清理DB异常不吞为单对象失败；复审未发现阻止本地交付的问题。

## 已执行验证

| 验证 | 结果/实际边界 |
| --- | --- |
| `npm test --workspace @small-city-basketball/api` | 最终120文件、1366项全部通过；包括COS adapter/config/持久化与CLI门禁回归 |
| API `typecheck`、`build` | 通过；编译包含新增PG集成测试的类型检查；build仅本地编译，不是pack或部署 |
| 受影响代码、JSON、YAML的Prettier；`git diff --check` | 通过 |
| 完整001—050与旧媒体升级、21项SQL约束 | 在PostgreSQL 18.6/PGlite 0.5.15 WASM隔离库 `scb_test_cos_schema` 通过；049已有媒体字节/摘要在050后保持不变 |
| 迁移/最小权限静态一致性 | 50项Migration、223表、128函数一致；001—049沿用main原文 |

原生PG/TCP环境不可用（本容器无postgres/docker，原生安装受容器权限限制），不能把WASM SQL验证当成多连接并发验收。`apps/api/test/cos-media.integration.test.ts` 已编写并通过类型检查，尚未执行；涵盖旧DB读取、新COS无payload、跨机构拒绝、幂等/分片、发布/Range/撤销/清理和PUT失败登记。正式COS、CAM最小权限、微信真机、Docker镜像和生产部署均未执行。

验证细节：[证据](../evidence/COS01/README.md)。下一步：在原生隔离 `scb_test_*` 库执行现有媒体/COS/本人资料相关PG集成及并发回归，再使用独立测试桶配置凭据做真实COS读写、删除和恢复验收；按正式部署授权决定何时迁移上线。

Git结果：分支 `feat/tencent-cos-media` 初始提交4170765已共享至PR45；合并最新main后的候选等待后续同步及精确CI。050已编写并仅在隔离WASM库执行，生产未执行。未发布包、未部署；账号安全只保留main既有成果，未顺带修改定位、UI或支付/投保/记分业务。
