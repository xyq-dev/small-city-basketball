# C19 隔离 CI 归档客户端接续

2026-10-28 Asia/Shanghai；负责人 Codex test_environment，集成人 Codex root。

- 基线 `ace5f47c9ac7c92da1add0245757a0741fb63e52`；独立 worktree `/workspace/scratch/608836f8d204/scb-c19-ci`，分支 `codex/c19-ci`。只修改 API CI 准备步骤及专用客户端辅助脚本、其测试和本交接；不修改业务或生产配置。
- 本机容器仅映射 UID/GID 0，无法按 PostgreSQL 要求使用普通用户启动，且没有 Docker。已确认此限制，不修改数据库 root 保护，不将本机测试描述为真实 PostgreSQL 验收。
- API job 使用与数据库服务相同的 `postgres:18.6-alpine3.24` 镜像运行 `pg_dump` / `pg_restore`。客户端容器以 runner UID/GID 执行，只挂载本次创建的私有归档目录，使用 host 网络访问该 job 的 loopback PostgreSQL；不挂载仓库、Docker socket、runner home 或整个临时目录。
- 输出 `SCB_PG_BIN`、`SCB_PG_WORK_DIRECTORY` 以及 `SCB_REQUIRE_ARCHIVE_RESTORE=1`。验证模块在该目录创建归档，严格模式缺少客户端或恢复角色时失败，不采用模板复制替代真实归档。
- 仅在 job 新建的 loopback `scb_test_*` 数据库服务创建 `scb_migrator NOLOGIN`，无超级用户、建库、建角色、复制或绕过行权限能力。升级验证只在其自身新建恢复库内赋予离线隔离所需的表访问权，运行时最小权限验证保持独立。
- 本机执行 `node --test scripts/ci-postgres-clients.test.mjs`：3/3，通过参数边界、含空格/引号路径、唯一挂载、密码不进入参数、非法目标拒绝检查；`node --check`、Prettier、`git diff --check` 通过。实际 Docker/PG18 客户端运行及完整升级验收尚待集成 CI，未声称已经通过。
- 未推送或创建 PR，未操作生产；由集成人 cherry-pick 本分支提交并验证最终 CI。

## C19 新页面的兼容布局场景

- 集成人追加分工后，在同一独立 worktree 同步已集成代码，新增 `tests/mini-program/fixtures/c19-*.json` 共 13 个合成场景。依据现有 C19 VM 测试中的合成 API 回应驱动实际 Page、视图转换和媒体进度方法，未使用真实账号或业务数据。
- 覆盖申请人建队表单与申请历史、机构审批、加入码与定向认领、本人只读成员关系、有效与失效关注、赛季机构榜单、未勾选的本人同意、本人统计、主办方提名、分片断点恢复与全片确认后的最终校验，以及普通参与者和机构管理员的账号入口。
- 全部使用仓库真实 WXML/WXSS 模板，320/390/430 三宽共 39 次静态渲染及文案/按钮启用状态检查通过。重点断言同意未勾选不可提交、失效关注不显示已收回资料、普通成员没有机构管理入口、上传100%仍等待最终校验。
- `playwright test tests/e2e/mini-program.spec.ts --list --project=desktop --grep c19-` 已确认自动发现 39 个布局用例（mobile project 按既有规则跳过重复的三宽矩阵）；未在本机执行浏览器几何检查（环境缺可用浏览器）。实际溢出、触控尺寸、字体和截图守卫由现有 CI 验证，不能把本次静态检查标记为微信工具或真机验收。
- 没有新增截图交付或 watcher，没有改产品样式；场景由现有 CI 自动发现并产生其既有测试产物。
