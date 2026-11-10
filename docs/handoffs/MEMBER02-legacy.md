# MEMBER02 · C22 旧库父链固定激活依赖

2026-11-10 Asia/Shanghai；作者 `membership_audit`；REVIEW / LOCAL_ONLY。

## 现场、原因与范围

- 独立目录 `/workspace/scratch/dc6a786e1a31/scb-member02-legacy`；origin `https://github.com/xyq-dev/small-city-basketball.git`；分支 `fix/member02-c22-legacy-activation`，基线 `7ff3f17db0ff02c793be133d225dd1c918f0bbb3`；开工干净，root 其他 dirty 文件未触及。
- root 提供的 CI252 API 日志显示旧库父链 publication 在 INSERT 时报告 `event_commercial_activations.membership_period_id` 不存在。独立读源码确认：C22 固定旧排赛仍导入当前 commerce/activation，MEMBER02 末尾 INSERT 在 OFF 模式也无条件加入052列；真正001–022 schema正确拒绝该列。本修复不改生产代码来支持未迁移数据库。
- root 明确独占授权：固定 activation 新夹具、旧排赛 import、工厂源守卫与直接测试、夹具说明、C22 集成严格断言和本交接。没有修改任何当前业务服务、readiness、Migration、权限、依赖或根汇总。

## 修复内容

- 固定与已有三份父链服务同一提交 `83ae15a64bce2a29566d22e3885ebb44a0772bdd` 的完整 `apps/api/src/commerce/activation.ts`；原 blob `3204ef950d71be26ee4827b8380fcf6c9bf3e944`、原 SHA256 `41fd448f246fefa9a6e9b8446c11848684b5f8cc04af3e5459bf22ba50a12c35`。
- 新 `c22-legacy-commerce-activation.ts` 仅相对导入重定位，派生 SHA256 `cb377584b248c7a70c7e0fdb92f4b2590c5d1492e34e7a3e18479d086eac273d`。没有改原 SQL、额度/期限校验、激活、事务或审计逻辑。
- 旧排赛仅将原 activation import 重定位到该固定 helper；新的派生 SHA256 `4a6872945b7ce34f394daffa1ef7110dc723db84875e5d356a60c7adcd72c9f5`，逆导入变换后仍须恢复原排赛 SHA256 和 blob，原固定身份未换。
- 工厂仍仅允许 NODE_ENV=test，并在创建前核验全部四份固定源；仅本实例替换原三个 provider，生产服务/全局 prototype 不变。
- C22 PG 父链构造前及记录基线前继续要求原22期、原78表、无C23列，并新增无052两类列/购买期表断言；正式 publication 后必须存在原 UNMETERED 激活与完整原审计元数据。
- 升级后的 snapshot 对原有激活行先严格断言新 membership_period_id=NULL，再仅去掉该新增字段；原有所有字段、来源、审计、迁移checksum/applied_at及任何额外行仍必须精确相等。未把旧夹具替换成完整当前 schema，未放宽升级后正常应用的版本门槛。

## 验证和接续

- `vitest run test/fixtures/c22-legacy-registration-source.test.ts`：1文件、6项全部通过；包含四份源身份、原激活+审计写入及限定实例provider验证，不连接数据库。
- `npm run typecheck --workspace @small-city-basketball/api`：通过。五个TS文件 `prettier --check` 与 `git diff --check`：通过。
- 真实 PG 不在本机运行，由 root 新候选隔离 CI 验证；本记录不将静态检查称为真实升级通过。没有执行被跳过的 PG 测试或伪造已通过结果。
- 仅本地精确提交本任务文件，不 push、PR 或 merge；无生产部署、账号/资金或外部凭据操作。无新增或执行 Migration，001–051完全未改，052也不由本切片修改。
- root 下一步：整合本切片和核心period参数修复，运行同一head完整真实PG；确认 C22 父链构造、052后旧行严格NULL断言及全原事实比较都实际通过，再推进浏览器、恢复和独立审查。
