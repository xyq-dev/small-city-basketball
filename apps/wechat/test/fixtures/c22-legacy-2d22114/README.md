# C22 / R05 旧客户端兼容夹具

两份 `.txt` 是提交 `2d22114ed75ddf4f549a1f2948363d0bd7867c02` 中原始 JavaScript 的逐字副本，不经过格式化、不随新 UI 更新。来源仓库为 <https://github.com/xyq-dev/small-city-basketball>。

| 夹具               | 原路径                                 | Git blob                                 | SHA-256                                                          |
| ------------------ | -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| event-setup.js.txt | apps/wechat/pages/event-setup/index.js | 74e31f6b2016533ee11757d86e899d5e030af57b | def712869ac771a3bb86041595dfcac260106dee17f32be2412f5690d98bfc63 |
| directory.js.txt   | apps/wechat/utils/directory.js         | 437a53ef060d20a8db21f62a5b83134b86653ca6 | 3fbdfbe0d381586763cf62b02c27d662c9aaa7c606b0b7e098ee2f87a85e8cd8 |

`c22-legacy-client.test.cjs` 校验这些哈希，在 VM 内执行旧页面的真实 `load`、`directoryView`、`listDirectory`、`unlistDirectory` 和旧公开目录 `fetchPage`。新私有 DTO、会话、确认和网络为明确的测试替身。测试证明新增私有字段可被旧页面读取，旧写入载荷不变，公开八字段仍可被旧严格解析器接收；它不验证新 UI、真实 API、微信运行时或真机。真实旧请求的服务端兼容另由 C18/C22 API 集成测试验证。
