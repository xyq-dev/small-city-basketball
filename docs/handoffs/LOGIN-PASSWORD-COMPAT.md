# LOGIN-PASSWORD-COMPAT 交接记录

## 上下文

- 更新时刻（含时区）：2026-11-10T23:15+08:00
- 负责人 / 会话标识 / 接收人：当前 Cursor 会话；接收人为下一审查者
- 实际绝对目录、仓库远端：`D:\Projects\small-city-basketball`，`https://github.com/xyq-dev/small-city-basketball.git`
- 实际分支 / 基线 HEAD / 当前 HEAD：`fix/login-password-compatibility`，HEAD 仍是 `53ac92640e3dc1e11c5022e81ac0f6ba7f1980d3`。`origin/main` 为 `9550e692a4950c3fec2b4872cfaa6bc97cccff1f`，多 24 个提交；没有 merge 或 rebase
- dirty 与已有他人修改：登录修复未提交。原有未跟踪归档 `SCB_UI005_LOCAL_MAIN/` 与 `docs/design/ui-v4/REFERENCE_V3/` 仍在，共 47 个文件
- 任务状态 / 整合状态（LOCAL_ONLY、BRANCH_ONLY、MAIN）：IN_PROGRESS / LOCAL_ONLY
- commit / push / pack / 部署 / Migration / 生产数据权限分别为：本轮均未执行，也未授权执行

## 本次完成

- 目标与实际变更文件：登录、改密当前密码、微信绑定和解绑、账号注销申请和取消核对已有密码时使用 1–128；新密码仍为 12–128。文件见任务卡。
- 需求/API/数据/决策同步位置：`docs/API_CONTRACTS.md`、`docs/ACCOUNT_MAINTENANCE.md`、`docs/operations/account-security.md`
- 分支成果是否已进入 main：否

## 验证证据

| 检查 | 实际命令或操作 | 环境及提交/工作区 | 结果 | 证据位置 |
|---|---|---|---|---|
| 隔离 PostgreSQL | `npx vitest run test/login-password-compatibility.integration.test.ts` | 一次性 loopback 库 `scb_test_logincompat`，已有 Migration 初始化后删除 | 7 通过 | 2026-11-10T17:56+08:00 |
| 会话与维护回归 | `npx vitest run test/change-password.integration.test.ts test/c02-login-names.integration.test.ts` | 空库 `scb_test_maintregress`，随后删除 | 18 通过 | 2026-11-10T17:57+08:00 |
| API 解析 | validation、change-password、account-closure-domain | 任务分支工作区 | 32 通过 | 2026-11-10T17:53+08:00 |
| 小程序 | `node --test` c10-account 与 account-closure | 同上 | 16 通过 | 同上 |
| 类型、构建、格式 | api/admin typecheck 与 build；本次文件 Prettier；`git diff --check` | 同上 | 通过 | 2026-11-10T18:00+08:00 |
| main 组合 `cd8ed1f` | 独立 detached 工作树，补丁无冲突 | 空库 `scb_test_mainregress`；工作树已删除 | 解析 44 通过/4 失败；管理端 34、小程序 16、隔离库 7 与 18 通过；安装自身依赖后 typecheck/build 通过 | 2026-11-10T17:59+08:00 |
| main 组合 `9550e69` | 新 detached 工作树，补丁无冲突；MEMBER02 契约段落保留 | 新空库 `scb_test_logincompat`，随后删除 | 管理端 34、隔离库 7、typecheck/build 通过。18 项会话/维护回归未在此 SHA 重跑 | 2026-11-10T19:18+08:00 |
| Linux 文件权限 | 未运行 | 无 WSL、Docker、Podman | 未执行。Windows 上同样 4 项失败，不能算通过 | 组合工作树输出 |
| Linux 文件权限复核 | Codex 在 Linux 上运行 `apps/api/src/account-maintenance.test.ts` | 以 `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266` 为基准的 28 文件补丁，SHA-256 `4FF8F6D2C73A33B3E50C4A660E5A433B97DFC5661C03672A35A3AC9CD30B4795` | 10/10 通过；`0400`、`0600` 和 symlink 用例全部通过 | 2026-11-18 Codex Linux 验证 |

测试计划、实际执行、CI 与线上结果分别记录。没有对应工具或网络访问时直接写明限制。

## 遗留与恢复

- 未完成项 / 阻断原因 / 解除条件：2026-11-18 Linux 复核已通过，文件模式和 symlink 不再阻断。Windows 上 `0400`/`0600` 未保留以及 `symlinkSync` 的 `EPERM` 仍是该系统限制。
- 已保存文件 / 未提交工作 / 可恢复点：候选工作树 `D:\Projects\scb-worktrees\login-password-compatibility-main`，基准 `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`；2026-11-18 核对差异与已验证补丁一致
- 下一位 AI 的第一条具体操作：在该候选提交上等待仓库 CI。合并前确认 PR HEAD 仍是这个提交，且 `main` 仍从 `ec69f875` 快进或只包含已重新核验的更新。
- 接手前必须重新核验的事实：分支、HEAD、未提交文件和归档
- Migration：不涉及
- 真实付费服务或生产影响：无。登录若仍返回 401，走账号核验或恢复，不能改库或跳过哈希

## Git 与同步结果

- 新提交、目标分支、推送或 API 更新结果：提交位于 `fix/login-password-compatibility-main`，基线 `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`，目标 `main`。推送和 PR 在该提交之后进行
- PR / 审查 / main 整合依据：Linux 上 `account-maintenance.test.ts` 10/10 通过，含 `0400`、`0600` 和 symlink。合并前仍需仓库 CI 通过，且 PR HEAD 保持这个提交
- 若未同步，写明原因及成果位置：源目录 `D:\Projects\small-city-basketball` 的未提交改动和归档不在本次提交中
