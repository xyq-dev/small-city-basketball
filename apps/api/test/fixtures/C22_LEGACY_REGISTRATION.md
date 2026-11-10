# C22 旧注册、排程与排名服务夹具

该夹具用于在真实、尚无 C23 列及本轮新表的 001–022 schema 上生成既有报名、冻结、排赛及公开赛事父链，然后验证当前迁移后缀升级。它不是完整历史应用镜像，也不是生产向后兼容入口。

- 来源：`xyq-dev/small-city-basketball@83ae15a64bce2a29566d22e3885ebb44a0772bdd` 的 `apps/api/src/registration-service.ts`、`scheduling-service.ts`、`standings-service.ts` 和其依赖的 `commerce/activation.ts`。
- 原始 Git blob、原文 SHA256 和派生夹具 SHA256 固定在 `c22-legacy-registration-api.ts`，构造 API 前逐一核验。
- 唯一源码变换是调整导入路径：历史服务的 schema 无关错误、校验、基础服务及安全辅助重定位到 `../../src/…`；排赛的 `./commerce/activation.js` 重定位到本测试目录固定的 `./c22-legacy-commerce-activation.js`；固定 activation 的 `./domain.js` 重定位到 `../../src/commerce/domain.js`。按每个源文件的精确规则逆变换后必须逐字节恢复来源原文 SHA256 及 Git blob，禁止改历史 SQL、状态判断或门槛。
- 工厂仅允许 `NODE_ENV=test`。它创建当前测试 API 后，只替换该实例 `SCB_APPLICATION_SERVICE`、`SCB_SCHEDULING_SERVICE`、`SCB_STANDINGS_SERVICE` 对象的 prototype 为各自已核验的历史服务。Pool、选项及控制器保持原引用；不改变全局 prototype，不影响另建的 API，不在正式 API 工厂加入旧 schema 分支。
- 本轮新排程和排名消费者会读取026模板、029同城和033裁定表，真实001–022 schema不存在这些表。因此仅旧夹具父链使用固定旧消费者；其余schema无关支持服务及HTTP控制器保持当前。不能据此声称整个旧版本已重新构建或官方旧包已验收，也不能用生产探表/吞错替代迁移验收。
- MEMBER02 的当前 activation 会写052新增的 `membership_period_id`，因此它也不再是旧 schema 无关辅助。测试排程现在绑定同一83ae来源的完整旧 helper，保留原付费检查、首次激活、UNMETERED/PAID来源与审计，既不略过函数也不提前给旧表加列。原 helper 的固定 blob 为 `3204ef950d71be26ee4827b8380fcf6c9bf3e944`；生产的当前 activation、readiness 和迁移要求不变。
- 测试在构造前及记录升级基线前确认 ledger 仍为22个迁移、`event_rulesets.require_participant_materials` 不存在。实际升级才执行完整023之后后缀；不先给旧表补临时列，不修改001–024或任何已执行checksum。旧API在记录基线前关闭，升级后的应用读取使用正常当前消费者。
- 旧父链还须实证052的 target_kind、membership_period_id 和购买期表均不存在，并核对原激活行与审计来源。升级后只对基线中已有的激活行，先逐行断言新 membership_period_id 严格为NULL，再排除这一个新增字段比较全部原有事实；新行、来源、审计、原迁移checksum与applied_at继续完整比较，不全局忽略会员来源。

夹具只有公开历史代码；测试生成的数据、账号、照片和口令均是隔离合成资料。真实 PostgreSQL 构造与升级结果以当前候选 CI 为准，静态 hash/typecheck 不代表已完成数据库验收。
