# COS02 实际后台配置契约

设计基于已交付的对象存储交互稿，保留现有后台导航、深蓝/橙色样式。新增平台级系统设置分组及对象存储页；已有机构设置、媒体业务页面和小程序界面保持各自用途。

## 数据与接口

Migration051新增四表：`storage_config_state` 单例CAS版本及草稿/active指针；`storage_config_revisions` 不可变目标与加密凭据；`storage_config_operations` 按actor+commandId的请求HMAC/终态回执/测试摘要；`storage_config_probes` 先持久登记的唯一检测对象及确认/清理时间。原迁移与媒体文件引用不改。凭据AES256GCM的AAD绑定revision ID、版本、模式、桶、地域及前缀，根密钥独立于数据库。

| 接口 | 行为 |
| --- | --- |
| GET `/v1/platform/storage` | 平台鉴权后读取脱敏草稿、资源版本、实际配置、检测与锁定/隔离/密钥准备状态；不返回密钥、密文或内部对象路径 |
| PUT `/v1/platform/storage/draft` | commandId+expectedVersion保存草稿；新凭据成对，留空保留；CAS/幂等，保存不启用 |
| POST `/v1/platform/storage/tests` | commandId+configVersion+confirmCloudTest；先持久操作，再清理旧检测登记/发新检测；结果仅对该保存版本有效 |
| POST `/v1/platform/storage/activation` | commandId+expectedVersion+configVersion+testId+privatePolicyConfirmed；核对有效测试、权限、隔离与待清理对象后切换active |
| GET `/v1/platform/storage/operations/:commandId` | 仅原actor可查询；网络未知不自动重发，真正中断检测仅在确认无执行锁后收口 |

公共类型位于 `packages/contracts/storage-settings.d.ts`。resource version与draft revision version分别使用；激活也推进资源版本，不能把它们混为同一个编号。HTTP Origin及会话防护沿用全局API规则。

## 运行时与并发

每次COS媒体上传/读取/清理在当前事务取全局非阻塞shared advisory锁73321051，再解析一次并固定store；保存、启用及跨提交连接测试使用同域exclusive锁。媒体请求已持身份/机构锁时不排队等全局锁，忙碌立即503并回滚，避免与离线撤权/改密形成锁序环。原数据库文件读取直接早退，不碰云配置。

跨提交测试使用同一个专用连接持有session锁，登记和阶段状态均持久化；终于解锁失败即销毁连接，不把带锁连接放回池。每个出站阶段之前重新核验会话、平台资格和恢复状态。未知PUT留24小时保护；新测试不以提前DELETE冒充物理清理完成。

待清理检测对象的地址与业务文件地址分别判断。只有存在待清理对象、且全部对象目标与草稿一致时，保存/测试入口允许维护该地址的凭据和清理登记对象；启用始终执行完整地址限制。清理后必须在桶验证、新登记及新PUT之前重新执行完整地址检查。如果旧active地址此时已有文件，清理可以完成，但检测返回FAILED/STORAGE_DESTINATION_LOCKED，不产生新检测对象。页面在cleanupPending期间保留原草稿维护/清理，清理完成后再根据实际业务锁显示恢复active地址，避免两种地址互相阻塞。

## 验收边界

源码、React模拟API组件测试、真实PG/HTTP测试、完整恢复与真实COS必须分别记录。开发用合成transport不会访问腾讯云；本地无PG的测试不能标为已执行。正式部署准备和失败恢复见[运维说明](../operations/admin-object-storage.md)。
