# P06-A API交接

集成人root最终更新（2026-10-22）：本模块已随PR7合并main f8af5c99fba294a40334c49a5d2e32f80c6acbf9；最终source addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11、CI39758913295全部成功372源码／123PG／12Mock＋14API／39表重启及正常／失败子库清理。模块交付为DONE / MAIN，最新接续见[总交接](P06-A.md)。下文作者原始检查点按历史保留，不代表当前未整合。原生OBS／CEF及生产没有验收。

2026-10-22，负责人 `/root/p01_domain`。状态 REVIEW（源码本地完成，待整合真实CI），integration LOCAL_ONLY。

## 开工上下文

实际目录 `/workspace/scratch/93747c9ad2cb/p06-api`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/P06-overlay-api`，基线 `ca68dea89f1625c86e2a90e43ffa936c49fd6186`。开工无业务改动，仅根集成人提供的未跟踪 node_modules 软链接；不提交该链接。

已完整读取AGENTS、CURRENT_STATUS、TASKS、COLLABORATION及[P06-A任务卡](../tasks/P06-A.md)。独占contracts两文件、overlay-*.ts、006及本交接；root负责app.ts接线、汇总文档和远端同步。不编辑旧服务或001–005，不新增依赖，不push。

## 检查点

- 精确DTO已单独提交 `6ebcf188c317da525f02b15ae9525f55debfd5eb`，通知root/UI/PG。固定模板SCOREBAR_1080P_V1、current未撤销记录（包括到期）、20条已撤销历史/historyLimit20/truncated。管理GET无credential键；命令成功仅ISSUE/ROTATE返回一次性credential。
- 私有预览坏FINAL时为null并附有限previewError，授权元数据/Event CAS及撤销仍可用；专用快照严格409。正确secret可恢复单一无效Cookie；重复/歧义Cookie404。
- 已完成OverlayService复用ApplicationService保护方法；OverlayController处理私有两路由，OverlaySourceController处理独立bootstrap/snapshot，同一SCB_OVERLAY_SERVICE provider，root负责app.ts接线。
- 管理Event从入口UPDATE，全部Grant锁后单次DB clock_timestamp采样决定TTL、当前状态及私人session有效性；Event与Grant版本／审计同事务。只读锁org→Event→Grant→专用session，不读取scb.sid身份，不依赖public publication或排名规则。
- 源证明单条限定match SQL左连接全部当前证据后复用confirmedResult。逐项新建有限DTO；未准备全null／collectedfalse，原始时钟只返回anchor值。管理命令不修改Match、统计、确认、记分lease。
- 正确secret先于Cookie验证；单一无效／其他grant Cookie可恢复，重复／歧义404。有效同grant session复用，新增session通过INSERT SELECT保留截止微秒精度。Cookie Max-Age向下取整且对PG当前微秒向上保守处理，避免Date截断使剩余不足1秒时Cookie多出一秒。
- 独立API复核发现并修正：新增session的published_matches FK可能等待现有记分Match UPDATE锁跨过Grant截止。新INSERT完成后使用一次MATERIALIZED clock_timestamp采样，以PG精确时间同时重检Grant/session共同截止；过期统一404且事务回滚，不返回Cookie。成功metadata.serverTime及Max-Age使用该最终fresh时刻；有效旧Cookie复用分支无写，保持原锁后单次采样。PG负责人另增真实FK阻塞跨截止回归，本地未执行PG。
- 006由独占schema子任务完成，独立technical审查CLEAR，SHA256 `94a54d6ae997774fd9b511dd39f5d4e1596b71c97384f2162e5c1dd8a7a39be6`。两表overlay_grants／overlay_sessions；scope＋Grant截止复合FK、单未撤销、Grant一次撤销、session不可变；未执行数据库。
- 稳定错误：Event CAS为VERSION_CONFLICT；已有有效Grant为OVERLAY_ALREADY_ISSUED；历史Grant操作为OVERLAY_GRANT_NOT_CURRENT；Grant CAS为OVERLAY_GRANT_VERSION_CONFLICT，均409。未知／跨scope404，实际event只读staff写403，无event权限私有404，格式422；独立授权失败统一404，坏来源409 RESULT_SOURCE_INVALID，无私密details。

## 验证与边界

2026-10-22 UTC本地实际验证：完整API源码11文件201测试通过（原155＋新增40 domain／6 HTTP），API typecheck、build及新源码／contracts Prettier检查通过；git diff --check通过。测试覆盖严格命令、TTL/CAS输入、Cookie歧义及专用身份、有限投影／rawclock／FINAL损坏、Set-Cookie与HTTP200／409，不以Mock证明数据库授权正确。

006仅已编写并独立静态CLEAR，未本地执行。真实PG及浏览器由root整合后CI验证，当前无本卡端到端完成证据；不尝试以root用户绕过PG保护。

Grant和session仅有限只读授权，独立于公开观赛和签发者私人session。无原生OBS/CEF、直播推流、可靠离线验收。

## 下一步

root串行整合本次API源码并接DI；PG代理按独立测试验证真实事务、撤销竞态、回滚、全部不可变约束及身份边界；扩展浏览器／重启后运行当前head完整CI。发现问题仅在本卡允许路径补丁，保留旧证据，不冒称原生OBS已验收。
