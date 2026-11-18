# LOGIN-PASSWORD-COMPAT：登录校验与新密码策略分离

## 当前事实（2026-11-10T23:15+08:00）

状态：IN_PROGRESS / LOCAL_ONLY。未提交、未推送、未合并。分支 `fix/login-password-compatibility`，HEAD 仍是 `53ac92640e3dc1e11c5022e81ac0f6ba7f1980d3`。最新 `origin/main` 是 `9550e692a4950c3fec2b4872cfaa6bc97cccff1f`，比本分支多 24 个提交。没有在本分支 merge 或 rebase。

线上 `POST /v1/auth/login` 对短密码返回 422 `VALIDATION_ERROR`，字段文案为“密码需为12–128个字符”。原因是已有密码核对调用了设置新密码用的 `passwordInput`。历史账号和密码是否真实有效尚未核验；本修复只让已有哈希进入核对，不表示短密码必然能登录。

## 范围

- `loginPasswordInput`：字符串、1–128 个 Unicode 码点、保留原文。登录、修改密码的当前密码、微信绑定和解绑、账号注销申请和取消使用它。
- 注册、初始化、重置、修改密码的新密码和离线维护继续使用 `passwordInput` 的 12–128。
- 管理端登录、改密当前密码、微信解绑，以及小程序账号页和注销页，与上述规则一致。没有改布局、品牌或无关样式。
- 不特判 admin，不硬编码密码，不跳过哈希，不自动建号。限流、ACTIVE、会话、审计和账号维护锁未改。

## 验证

2026-11-10T18:05+08:00：任务分支上，登录兼容集成测试 7 项通过，改密与登录名/离线维护回归 18 项通过。解析测试 32 项通过。小程序账号页和注销页 16 项通过。API 与 admin 的 typecheck、build 通过。改动文件 Prettier 检查通过。`git diff --check` 没有空白错误。

同一轮把修复应用到独立的 `origin/main` 工作树，没有 merge。代码补丁无冲突；`docs/API_CONTRACTS.md` 因 main 已新增 MEMBER01 与 TMX01 段落，只手工替换密码规则那一句。组合工作树的解析测试 44 项通过、4 项失败，管理端 34 项通过，小程序 16 项通过，隔离库 7 项和 18 项通过。该工作树安装自己的依赖后，typecheck 与 build 通过。

未通过：`account-maintenance.test.ts` 的 4 项文件模式和 symlink 测试在 Windows 失败，原因是 `0400`/`0600` 未保留，以及 `symlinkSync` 返回 `EPERM`。本机没有 WSL、Docker 或 Podman，Linux 复验没有执行，这 4 项不能算通过。没有 CI 或生产操作。

## 边界

账号注销申请和取消已改为核对已有密码。没有新增或修改 Migration 文件。既有 Migration 只在一次性本机隔离库执行，库已停止并删除。2026-11-10T19:25+08:00：`origin/main` 新增 12 个提交到 `9550e69`，只触及 `RuntimeApp.tsx` 的会员入口、`app.ts` 的会员控制器和 `package.json` 脚本，没有改密码校验。独立工作树打上本次补丁无冲突；契约文档保留 MEMBER02 段落并只替换密码规则句。该组合上管理端 34 项、隔离库 7 项、typecheck 和 build 通过。会话撤销与并发维护的 18 项没有在这个新 SHA 上重跑。2026-11-10T23:15+08:00 再次核验：HEAD、工作区凭据差异和 `origin/main` `9550e69` 都未变，已有测试没有重跑。本机仍无 WSL、Docker 或 Podman，当时 Linux 文件模式和 symlink 仍未验证。

2026-11-18T09:11+08:00：候选工作树 `D:\Projects\scb-worktrees\login-password-compatibility-main` 的 HEAD 与 `origin/main` 都是 `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`。28 个文件的未提交差异与补丁 `login-password-compatibility-against-ec69f875.patch` 一致，SHA-256 为 `4FF8F6D2C73A33B3E50C4A660E5A433B97DFC5661C03672A35A3AC9CD30B4795`。Codex 已在 Linux 上验证这份以 `ec69f875` 为基准的补丁：`apps/api/src/account-maintenance.test.ts` 10/10 通过，`0400`、`0600` 和 symlink 用例全部通过。此前 Windows 上的 `EPERM` 与权限位结果不再阻断这次提交。
