# R6MAP：地图视野搜索实现

状态：IN_PROGRESS；integration：LOCAL_ONLY。负责人：Codex `/root/implement_map`；2026-11-01 Asia/Shanghai。

基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`；目录 `/workspace/scratch/aad368826b09/scb-six-map`；分支 `work/r6-map`；origin `https://github.com/xyq-dev/small-city-basketball.git`；开工工作树干净。

依据：[地图设计](../design/MAP_VIEWPORT_SEARCH.md)。实现范围为视野查询合同、同城查询/DTO、原生同城地图交互及针对测试，不改下单和费用语义。不新增迁移，不触及生产、凭据或外部地图调用。共享汇总和远端同步由root负责。

计划：后端有限矩形与签名游标 → 前端主动搜索/范围确认/迟到响应隔离 → 单元/原生页面与PG集成测试 → root集成CI。无本地PostgreSQL运行通道，真实PG测试需在隔离CI执行；未执行不会标通过。

兼容方案：旧请求保留旧响应结构；能力放入已有locationCapability对象的可选viewportSearch字段；只有携带viewport与searchVersion=2的请求返回searchArea。32字节签名key允许由组合根注入，多实例部署必须共享专用key；未配置采用进程临时key，旧游标重启后需重读。

首个切片已实现：GCJ02矩形规范化及100km上限、参数互斥、SQL矩形过滤与同精度距离/id keyset、HMAC签名v2游标、能力与响应协商、POST no-store。旧同城查询/预约/收费路径保持原语义。API TypeScript检查通过；定向领域测试11项通过。新增4项真实PG集成测试（边界、58项同坐标分页、撤销/范围与签名、HTTP兼容/能力）；本地无PG，尚未执行。前端接线和真机验收仍待完成，未宣称完整交付。

第二切片完成原生页面与严格DTO读取器：监听begin/end并隔离视野读取和请求；主动getRegion/getScale后POST；无GPS可用；跨城临时确认；按已提交范围分页、去重且不移镜；失败保留范围、恢复和城市列表入口；隐藏/退出/账号/筛选变化隔离旧回调。地图视野不会修改预约地址或收费同意。旧接口未声明能力时不发送新参数。

验证：领域11项通过；API typecheck通过；同城原生页面27项通过（新增7项覆盖多种并发/故障）；微信全量1015项通过，1项Windows专用测试在Linux按原设置跳过。格式检查通过。真实PG四项尚未运行；10万条性能目标尚未测量；iOS/Android基础库与320/390/430真机验收未执行。上述缺口不是Mock通过或上线结论。
