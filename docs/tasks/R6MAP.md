# R6MAP：地图视野搜索实现

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

状态：REVIEW；integration：BRANCH_ONLY。负责人：Codex `/root/implement_map`；2026-11-01 Asia/Shanghai。

基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`；目录 `/workspace/scratch/aad368826b09/scb-six-map`；分支 `work/r6-map`；origin `https://github.com/xyq-dev/small-city-basketball.git`；开工工作树干净。

依据：[地图设计](../design/MAP_VIEWPORT_SEARCH.md)。实现范围为视野查询合同、同城查询/DTO、原生同城地图交互及针对测试，不改下单和费用语义。不新增迁移，不触及生产、凭据或外部地图调用。共享汇总和远端同步由root负责。

计划：后端有限矩形与签名游标 → 前端主动搜索/范围确认/迟到响应隔离 → 单元/原生页面与PG集成测试 → root集成CI。无本地PostgreSQL运行通道，真实PG测试需在隔离CI执行；未执行不会标通过。

兼容方案：旧请求保留旧响应结构；能力放入已有locationCapability对象的可选viewportSearch字段；只有携带viewport与searchVersion=2的请求返回searchArea。32字节签名key允许由组合根注入，多实例部署必须共享专用key；未配置采用进程临时key，旧游标重启后需重读。

首个切片已实现：GCJ02矩形规范化及100km上限、参数互斥、SQL矩形过滤与同精度距离/id keyset、HMAC签名v2游标、能力与响应协商、POST no-store。旧同城查询/预约/收费路径保持原语义。API TypeScript检查通过；定向领域测试11项通过。新增4项真实PG集成测试（边界、58项同坐标分页、撤销/范围与签名、HTTP兼容/能力）；本地无PG，尚未执行。前端接线和真机验收仍待完成，未宣称完整交付。

第二切片完成原生页面与严格DTO读取器：监听begin/end并隔离视野读取和请求；主动getRegion/getScale后POST；无GPS可用；跨城临时确认；按已提交范围分页、去重且不移镜；失败保留范围、恢复和城市列表入口；隐藏/退出/账号/筛选变化隔离旧回调。地图视野不会修改预约地址或收费同意。旧接口未声明能力时不发送新参数。

验证：领域11项通过；API typecheck通过；同城原生页面27项通过（新增7项覆盖多种并发/故障）；微信全量1015项通过，1项Windows专用测试在Linux按原设置跳过。格式检查通过。真实PG四项尚未运行；10万条性能目标尚未测量；iOS/Android基础库与320/390/430真机验收未执行。上述缺口不是Mock通过或上线结论。

root追加委派：完成原同城预约/约赛的同事务prepare+execute入口、跨城派单源订单桥以及撮合STAFF/TEAM桥（PLAYER由另一实施者负责）。已实现锁先行、绑定服务器候选与实际地点、报价/商户/差旅冻结复核、源预约/回执/日历同事务写入；派单快照保留dispatchQuote原报价和offerId/quoteHash引用。新增桥边界5项测试通过，与地图领域共16项通过；API typecheck通过。新增4项真实PG源事务测试（回滚重试、竞争锁位、旧回执兼容、真实球队约赛）尚未运行。dispatch端真实报价转换测试由dispatch实施者接固定method执行。此追加实现不改地图查询或旧迁移。

2026-11-01 Asia/Shanghai，root追加有偿派单审查与测试：独立worktree `scb-six-map-review`，分支 `work/r6-paid-dispatch`，从595b61a同步到19cb239（含045暂占约束修复）。仅新增dispatch-source-adapter单测、r6-paid-dispatch真实PG测试及本任务记录，未修改root拥有的适配器。独立只读审查未发现确定缺陷：真实原预约、交易、暂占转换和两类回执沿用同一PoolClient；正价报价缺少匹配的canonical trade_order会抛错并回滚。新增9项边界单测已通过，API typecheck通过。新增2项真实PG测试待隔离CI：完整1300分服务/差旅订单与同命令重放；未接收费桥以及实际收费订单创建后失败时，源预约/交易/历史/回执一并回滚、原暂占完全恢复且同命令可重试。所有支付调用都是遇调用即失败的隔离桩，未执行外部支付。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。

2026-11-01 Asia/Shanghai，root委派CI153培训管理页窄屏字体小修：独立 `scb-six-map-ui` / `work/r6-training-font`，基线d47a579，唯一业务改动为training-manage/index.wxss在导入样式后把input/textarea固定为16px，符合UI_SPEC手机表单16px规范，修复26rpx在320/390/430逻辑宽度低于门槛的问题。未改JS或service。原生培训既有10项通过、diff检查通过；本地无Playwright浏览器可执行文件，三宽度真实兼容布局复跑交root隔离CI，不以源码VM代称浏览器测量。

2026-11-01 Asia/Shanghai，CI153旧X12隐私PG失败修复：独立 `scb-six-map-privacy` / `work/r6-local-test-isolation`，基线7631660。旧测试按全县默认20条随机UUID排序取第一页，R6先行保留约60条公开样本后，新建X12供给可合法落在后页。仅调整测试fixture：保存完整UUID唯一title，并通过正式publicList的q过滤定位此样本，新增结果恰为一条断言；原隐私禁字段、距离、地图能力和公开slot断言全部保留。未改生产搜索排序、分页或资格筛选。格式/diff通过；真实PG本地无环境，待root隔离CI复跑。

2026-11-01 Asia/Shanghai，CI154 picker后续小修：独立 `scb-six-map-ui2` / `work/r6-training-picker`，基线b9cee023。training-manage的picker字号由27rpx改16px，输入/文本域保持已验16px。以实际WXML/WXSS buildPreview生成320/390/430三宽度，通过JSDOM检查初始页全部可见表单（机构picker及理由textarea）及picker子view均为16px；320时picker继承24px行高+两侧10.24px垂直padding，文本域64px高度，未见字号或声明高度低于门槛。JSDOM不是浏览器几何/真机验收；本地无Chromium，实际布局仍由CI复跑。既有培训native10/10与diff检查通过，未改JS/service。
