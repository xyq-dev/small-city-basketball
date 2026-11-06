# COS02 后台对象存储配置

## 2026-11-07T01:55+08:00 CI226最小修复冻结（等待新head完整CI）

root已复制并核对051=31e85e17、服务PG测试=dca5d1c5、c19升级测试=9fb413b8。仅6行新051守卫变化：只有cleanup_attempted_at实际改变时验证非空/递增/非未来；成功删除强制保留原失败时间。原身份不可变、PUT确认不可逆和未知PUT24小时保护原样保持。原轮换失败例加强原时间逐字保留，新第12例在未删除行验证清空/倒退/未来拒绝、确认/删除保留历史成功，避免终态守卫假阳性。独立安全复核冻结SHA通过，无新增P1/P2；旧001—050未改。

c19只补051精确inactive/version0种子断言，旧表行hash、checksum与备份恢复条件不放宽。root全仓typecheck、两份PG测试Prettier及diff通过；作者另5unit通过。环境无PG，本次服务12＋HTTP4及完整集成须由新精确head实际CI确认，不用旧三项成功拼接。当前未合并、未部署，051未在生产执行。


## 2026-11-07T01:48+08:00 CI226失败定位（REVIEW / BRANCH_ONLY，未合并）

精确候选a1014c7的CI226：admin、account-security、production成功；API既有PG集成632通过/3失败。新增HTTP4/4通过、服务10/11通过。真实PG暴露051探测守卫缺陷：失败清理已记录cleanup_attempted_at，随后只更新deleted_at时保留值被<=比较误拒，阻止凭据轮换后清理。backend修正只对实际改变的时间验证推进、同时禁止清空历史，独立安全复核进行；不能把旧审查无finding当作新修复验证。

另两失败是c19升级种子清单缺051唯一storage_config_state行，导致后续基线未赋值级联；ops最小补精确allowlist与全部字段inactive/version0断言，不放宽旧数据、迁移checksum或恢复指纹。修改已复制root，类型/格式/diff通过，真实PG待新head实跑。API后续原生HTTP、重启及API E2E因前置失败被跳过，不计通过。完整日志位于本地ci-evidence/42261688932-api.log与[CI226](https://github.com/xyq-dev/small-city-basketball/actions/runs/42261688932)。


## 2026-11-07T01:31+08:00 PR47与页面实检（CI运行中）

已普通同步 `feat/admin-cos-settings`，提交 `a1014c7f648c8199e642cb2071df4949ded8cea0`；远端tree与本地暂存tree完全一致（90a0966b）。[PR47](https://github.com/xyq-dev/small-city-basketball/pull/47)以main7b451c5为基线。Application checks #226 / run42261688932在执行；账号安全已通过、admin格式/类型/单测/构建已通过、API完整迁移链/恢复边界/剩余模块PG已通过，最终套件仍待实际完成。自动Code Review此head无finding。Windows工具workflow的paths不覆盖本次改动，预期不触发。

实际RuntimeApp与StorageSettingsPage编译产物在内部浏览器完成桌面/390/320宽实检；320 main实测clientWidth=scrollWidth=320。合成API走通保存草稿（密钥输入清空）、明确检测确认、私有策略勾选与二次启用确认，GET核对版本后显示生效。HTTP预检不具备secure-context randomUUID，仅临时合成harness提供确定性命令编号；未改产品代码。此结果只验证UI，不能冒称真实COS连通。临时harness已删除、preview已停止，git工作区此前干净。生产未部署、051未在生产执行。


## 2026-11-07T01:22+08:00 代码冻结与本地验收（REVIEW，等待隔离CI）

已收齐后端、动态运行时、后台页面和运维恢复实现；独立安全复核已收口全部已知P1/P2，包括非阻塞shared锁、PUT前再次核验、中断检测回执、403清秘密与固定目标版本、后续已生效版本取代和异桶草稿修回实际位置。最终前端源码f33d4748/测试670dee05已与作者冻结版逐字节一致。

root已执行完整npm test：管理620/API1397/微信1620通过（1既有平台skip）/CLI12/新运维11通过（1实际主机UID能力skip）；类型、格式与两端build通过。随后只增加前端权限/固定回执/草稿恢复回归，最终34项定向（含5路由）再次通过，作者独立29项也通过。最终同head完整CI仍待同步后实际执行，不拼接旧候选结果。

051已编写，001—050原文未改；静态inventory为51迁移/227表/132函数。新增真实PG service11＋HTTP4场景尚未本地执行（环境无PG/Docker），需隔离CI确认。根密钥脚本、最小权限和非空恢复快照已纳入；没有真实云凭据/对象/付费资源或生产动作。下一步普通同步同名分支、创建PR并运行完整CI，再核验审查和main并发后收口。

## 2026-11-07T01:00+08:00 实施检查点（LOCAL_ONLY）

root已冻结共享DTO及全局锁73321051，完成API依赖注入与App/RuntimeApp路由/平台权限入口接线；后端、运行时和前端各独立worktree实施，旧目录与改动均保留。运行时6份冻结文件已逐字节复制：作者直接45项通过，尚不把作者报告当最终整合测试。后台真实页面已在独立worktree通过类型检查，组件测试与后端PG场景仍在编写；051、加密配置服务与探测生命周期独立实现中。ops正同步最小权限、恢复inventory和根密钥初始化脚本。

本地npm ci --offline --ignore-scripts成功；没有Docker/psql/postgres/initdb，真实PG/迁移与完整恢复将由隔离CI执行。当前原子代码切片尚未整体验证，所有新改动未提交/未同步，不是main/生产事实。下一步收齐冻结源文件、定向/全仓验证与独立安全复核，再普通Git同步PR并跑完整CI。未访问真实云、生产或新凭据。

- 状态：IN_PROGRESS / LOCAL_ONLY；2026-11-07（Asia/Shanghai）。
- 唯一集成人：Codex root；基线 main `7b451c5bad7c1a7068a0fda6d962e36a3a1d0e9c`。
- 根目录：`/workspace/scratch/7ac4ead1fd7e/cos-settings-impl`，分支 `feat/admin-cos-settings`；开工时干净。原 checkout 与已有产物保留。
- 用户明确要求新增实际「系统设置 → 对象存储」页面；沿既有本项目开发、Git同步、PR/隔离CI与审查后合并授权推进，不执行生产部署、生产Migration/数据、真实云凭据配置或付费资源操作。
- 设计依据：[已交付交互稿](https://chatgpt.com/library?file_id=libfile_2b8ac6f7bd8c81918cf3326b56bf6e58&account_id=personal)。仅当前新增入口采用该设计，不改既定其他页面视觉。

## 允许范围与分工

root：contracts、app.ts 接线、App/RuntimeApp 导航及身份集成、任务/交接/规范和最终Git。backend：新 storage-settings 服务/控制器/加密与runtime loader、051和相关单元/PG测试。runtime：媒体存储resolver、COS适配器、cleanup CLI及对应测试。frontend：仅新 storage-settings React目录及组件/API测试。ops：新表最小权限/恢复inventory、初始化加密根密钥模板与相关检查。实施者各独立worktree，不改共享汇总或他人路径；root统一纳入。

## 冻结业务规则

1. 平台全局配置，仅 ACTIVE platform_operators；机构OWNER/ADMIN不自动获得权限。所有接口再次校验有效会话/平台身份，沿用CSRF/Origin防护。
2. DB保存不可变revision，独立32字节服务端加密根密钥，AES256GCM/AAD绑定版本与目标；凭据只写不回显、不进日志/操作回执/浏览器持久化。
3. 保存草稿不启用。测试绑定保存版本与凭据，限频且有效10分钟；管理员明确确认真实检测可能产生云请求。私有策略仅人工确认，不伪造桶策略自动检测。
4. 检测对象先持久登记再PUT；未知PUT/崩溃按24小时宽限保留登记及地址锁，不能提前DELETE冒充清理。已确认PUT完成的对象可回读校验再DELETE。重试先处理原登记，有界不触碰业务对象。
5. activation全局exclusive advisory锁73321051，媒体事务同键shared锁。每操作固定一次store；只有确证无active配置才兼容env，配置/DB/解密故障不回退数据库。DB旧文件读取不读取云配置。
6. 有云文件或待清理登记禁止换桶/地域/前缀，不提供切回DATABASE入口；只允许原位置换凭据。原限额8MiB/机构128MiB不变。
7. 每次运行时解析/检测/启用先核验恢复隔离和数据库状态，再加载密钥。GET确认实际resolver所用版本后前端才展示已启用；未知结果只查原commandId，不盲目重放含密钥保存。

## 必须验证

平台/机构权限、加密与无明文回显、CAS及原命令幂等/未知结果、探测生命周期和迟到PUT、凭据轮换与旧文件读取、实际resolver版本、恢复禁用、最小权限与全量迁移/恢复、前端身份切换与状态/对话框及320/390窄屏。运行项目格式/类型/源码/构建及完整隔离CI。真实COS/微信和生产另列未验，不以替身测试冒称成功。

Migration051已编写，尚未执行生产迁移；最终提交及隔离CI结果以后续实证记录为准。
