# C02-auth 用户名兼容登录及离线账号维护

2026-10-23（Asia/Shanghai）；负责人：account_login；状态：REVIEW / LOCAL_ONLY。实现及静态安全复核完成，真实PG/浏览器验收待环境补齐，不标DONE。

## 现场与范围

工作目录 `/workspace/scratch/dc6a786e1a31/c02-auth`，分支 `feat/C02-auth`，基线 `153421668ea74378df859a4b7c21df7da11ad77e`。独立worktree初始物化由root修复后已核验干净；没有覆盖原工作区。仅修改账号/登录相关API和UI、009迁移、账号维护CLI及相关测试。无生产操作、Git提交推送或密码值记录。

## 冻结设计

- `users.login_name` 可空，小写ASCII，首字母为字母、总长3–32，只允许字母数字下划线，唯一。旧用户默认NULL，邮箱保持。
- `/v1/auth/login` 请求继续使用 `email` 字段，值可为邮箱或用户名；会话DTO不变。别名和邮箱共用同一用户/IP限流键，未知/停用账号继续恒定认证错误与dummy scrypt。
- UI登录输入为“邮箱或用户名”；注册仍只收邮箱，不降低密码12–128字符规则。
- CLI仅从 `ACCOUNT_MAINTENANCE_INPUT_FILE` 读取0400/0600、当前UID所有、非符号链接的有限普通文件，strictJSON为 `email/loginName/password/reason`。拒绝argv及inline输入；使用已有密码hash实现。
- 登录事务在锁用户前取该用户共享advisory事务锁；维护事务先取同key独占advisory锁，确保所有先行登录结束、新登录被阻挡后，才枚举并锁该用户全部现有会话，再锁用户。核对ACTIVE及读取候选的旧hash/login_name未变化，更新仅目标账号、撤销全部旧会话、写审计；审计失败整体回滚。此协议防止“维护漏枚举的新会话请求先锁session后等user”的三方死锁。
- 审计actor使用本次创建的DISABLED不可登录系统主体，hash为不可验证哨兵，无机构权限，不冒充目标用户。root已批准此方案。metadata仅维护来源、原因和撤销数量，不含密码、hash或会话令牌。维护要求新密码与当前密码不同，确保成功后旧密码确实失效。

## 运维入口（未执行）

准备与运行用户一致所有、0400/0600的输入文件及已有受控migrator数据库URL文件，以 `NODE_ENV=production`、`ACCOUNT_MAINTENANCE_INPUT_FILE`、`DATABASE_URL_FILE` 显式提供；两个私有文件均拒绝符号链接且有大小上限。正式CLI入口为 `node apps/api/dist/account-maintenance.js`。数据库角色必须为scb_migrator/scb_admin或数据库superuser；scb_runtime明确拒绝，不扩张日常runtime更新凭据的权限。输出仅状态、目标/系统主体ID及撤销数量。不得重跑bootstrap-owner、重建目标账号/机构或直接跳过密码策略。

本卡没有执行任何实际账号或密码修改。用户需要在服务器安全输入符合策略的新密码，不能把聊天中的值写进仓库。

执行维护前须先部署本轮迁移及包含同一advisory协议的所有API进程，核验没有旧版本副本；不能只把新CLI放到仍运行旧登录代码的环境。成功后原部署密码领取文件可能已过时，应由实际运维按私有文件策略更新或归档；CLI不会猜测或覆盖未知路径。

## 验证与接续

首次实现：API源码20文件/268测试通过，UI直接相关2文件/29测试通过。独立安全静态审查发现维护与登录三方死锁窗口及数据库URL文件保护不足，已按上述协议修复并增加测试。修复后完整strict（含tests）、API构建通过；直接相关API源码3文件/26测试通过。独立复核确认这些静态问题已闭合，另独立执行维护/validation源码21项通过；与作者测试分开记录。最终增加拒绝复用旧密码检查及相应源码/隔离PG用例：维护单文件10/10通过（含真实密码验证器），完整strict再次通过。源码格式及 `git diff --check` 通过。

真实PG集成8项已编写：兼容登录/身份不变/全部旧会话撤销、拒绝复用旧密码、未知及停用一致错误、别名共用限流、重复别名并发原子性、审计失败回滚、三方锁竞态、约束及迁移重放。本环境无可用PostgreSQL/Docker，尚未执行；不能以源码测试代替数据库或浏览器验收。没有生产Migration或实际密码修改。

009仅新增列和索引，无新增业务表；root需同步迁移数量、checksum和恢复指纹列清单等受影响验收。不需要给runtime新增users列UPDATE权限。旧浏览器测试精确登录标签“邮箱”须由root在对应登录步骤同步为“邮箱或用户名”，注册步骤保持“邮箱”。
