# R6MAP接续

2026-11-01 Asia/Shanghai。当前IN_PROGRESS/LOCAL_ONLY；上下文、范围与计划见[任务卡](../tasks/R6MAP.md)。

首个切片：后端视野合同、签名分页、真实矩形SQL与no-store完成，API typecheck及领域11项测试通过。新增 `apps/api/test/r6-map.integration.test.ts` 四项真实PG测试，未在本地执行，需root/CI隔离库运行。下一步完成原生地图主动搜索、跨城确认、视野代次隔离与页面测试。

组合根接线：`LocalServicesService`第六参数可选 `{cursorKey: Buffer(32), enabled: boolean, maxSpanMeters: number}`。推荐专用签名配置注入以支持多实例；缺省为进程临时32字节key（重启或跨实例旧游标拒绝并要求重读），功能默认开启，边长上限默认100000米，可配置1000–100000。无需新业务表或索引迁移；性能目标尚未压测。不触及预约事务；root可串行集成预约重构。

只有显式 `searchVersion:2` 且带 `viewport` 才增加顶层 `searchArea`；能力放已有 `locationCapability.viewportSearch`。视野模式不依赖外部地图解析商开关。没有Migration、生产或外部服务操作。
