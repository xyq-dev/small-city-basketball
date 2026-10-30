# C22 旧注册服务夹具

该夹具用于在真实、尚无 C23 列的 001–022 schema 上生成既有报名、冻结、排赛及公开赛事父链，然后验证 023–024 升级。它不是完整历史应用镜像，也不是生产向后兼容入口。

- 来源：`xyq-dev/small-city-basketball@83ae15a64bce2a29566d22e3885ebb44a0772bdd` 的 `apps/api/src/registration-service.ts`。
- 原始 Git blob、原文 SHA256 和派生夹具 SHA256 固定在 `c22-legacy-registration-api.ts`，构造 API 前逐一核验。
- 唯一源码变换是把 `from './…'` 改为 `from '../../src/…'`，使测试目录中的历史服务引用当前、schema 无关的错误、校验、基础服务及安全辅助。逆变换后必须逐字节恢复来源原文及 Git blob，禁止改历史 SQL、状态判断或门槛。
- 工厂仅允许 `NODE_ENV=test`。它创建当前测试 API 后，只替换该实例 `SCB_APPLICATION_SERVICE` 对象的 prototype 为已核验的历史 RegistrationService。Pool、选项及控制器保持原引用；不改变全局 RegistrationService.prototype，不影响另建的 API，不在正式 API 工厂加入旧 schema 分支。
- 其他排赛、观赛及其 HTTP 控制器沿用当前测试代码，它们不依赖 024 的本人资料列。该适配范围是本夹具的明确边界，不能据此声称整个旧版本已重新构建或官方旧包已验收。
- 测试在构造前及记录升级基线前确认 ledger 仍为22个迁移、`event_rulesets.require_participant_materials` 不存在。实际升级才执行023–024；不先给旧表补临时列，不修改001–023或历史 checksum。

夹具只有公开历史代码；测试生成的数据、账号、照片和口令均是隔离合成资料。真实 PostgreSQL 构造与升级结果以当前候选 CI 为准，静态 hash/typecheck 不代表已完成数据库验收。
