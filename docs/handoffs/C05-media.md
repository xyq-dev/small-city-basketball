# C05 MEDIA 接续检查点

2026-10-24（Asia/Shanghai），c04_ui独占媒体实现；IN_PROGRESS / LOCAL_ONLY。worktree /workspace/scratch/dc6a786e1a31/c05-media，branch feat/C05-MEDIA，基线ead3a62，合同首commit0b8b7bb（后续字段增量未提交）；原node_modules symlink保留且不纳入源码。未push/无生产操作。root已接受3表bytea方案与端点，root负责app/provider/大body特定路由/manifest/恢复接线；分组作者将原publicAccess改protected供媒体继承，group UI负责PublicPages原页mount。

已落地015_c05_media.sql三表、media-domain/service/controller、新media合同、媒体api及三个实际新panel。EntryPages/ScoringPages已加用户显式展开入口，展开后真实读取/上传/下载/建草稿/发布/撤销/清除/对时；不在旧页自动请求或伪造媒体。公开panel轮询每次原grant，403/404/410清播放器，离线/陈旧隐藏source。外部资源只受信配置HTTPS且服务端不抓取，明确无法撤回第三方已知URL。

真实合成MP4来自ffmpeg64x64黑色1秒H264 /tmp/scb-c05-synthetic.mp4；PDF完整page/xref/font文本 /tmp/scb-c05-synthetic.pdf，pdfinfo实读1页/623bytes/无JS/无加密；TS base64 fixture在apps/api/test/media-fixtures.ts，不提交原临时二进制。PNG1px合成。新增17域测试已本机通过，admin完整typecheck已通过。7项真实PG集成用真实字节/Range/旧grant/确认映射/清除/并发CAS/额度竞争（valid MP4 free-box填充）已编写，尚未执行，不记PG通过。

本地API typecheck当前依赖已知publicAccess上游protected修改，私有合同新增rosterRevisionId已告root同步；最终整合检查由root。正在补新UI/component及transport回归，尚未提交业务代码。下一步跑已实现范围必要本机检查、记录精确文件/结果后提交交root；禁止把本机JSDOM/合成媒体/协议测试称为真机OBS或真实直播/转码。

## 实现冻结前验证

本机admin typecheck通过，41文件375测试全通过（原363+新12），admin build成功（既有大入口chunk提示保留，未扩大重构）。API全量26文件403源码测试先通过（原386+新17），后追加4 transport测试及安全撤销/独立STALE读取修复，2文件21项定向再次全通过。最终admin新12项再次全过。PNG经ffmpeg解码无错误，MP4经ffprobe确认为H264/64×64/1.000秒，PDF经pdfinfo确认为完整1页PDF/无JS/无加密。最后API完整typecheck仅报告上游StandingsService.publicAccess仍private；根group作者已改protected，等待集成；没有其它TS错误。未本地执行PG/Migration015/真实浏览器/生产。

7项PG只编写未执行。额度用可播放MP4追加合法free box形成8MiB，多次owned filler在同一机构真实落库逼近128MiB，两次并发真实HTTP上传只允许一条成功，随后只撤销/清除本测试掌握ID的填充正文。服务数据库guard也直接串行锁org检查总字节，防单纯前端额度或竞态。所有新文件均在表内，无外部volume。published media引用已撤销/清除文件时列表和content都隐去；私有凭证从不生成public key。

新增实际接线：EntryPages.tsx在本报名读取授权成功后挂EntryFilesPanel，ScoringPages.tsx正式单场页挂MediaPanel，默认显式展开才请求；PublicPages由group UI作者接PublicMediaPanel并转发注入fetcher。公有403/404/410清源；网络陈旧/离线隐藏video/img/external href，授权新读取成功后才恢复。固定三panel路径为apps/admin/src/media/MediaPanels.tsx（EntryFilesPanel/MediaPanel）及PublicMediaPanel.tsx。

root接线：MediaService(pool,ApiOptions,{trustedExternalHosts?:string[]})；MediaController/PublicMediaController token SCB_MEDIA_SERVICE；大JSON只两个POST /v1/orgs/:orgId/entries/:entryId/media-files 与 /v1/orgs/:orgId/matches/:matchId/media-files，12MiB/入解析前并发2，其余100KiB。反向代理同限定两路径body上限。原publicAccess仅改protected，语义由group作者保留。合同index仅root出口media.d.ts。

manifest精确：media_files SELECT/INSERT，updateColumns version,payload,revoked_at,revoked_by,purged_at,purged_by；match_media SELECT/INSERT，updateColumns status,version；media_markers SELECT/INSERT，无UPDATE/DELETE。文件正文只准清null，不能替换/恢复；PG CHECK核byte_length与内置sha256。fingerprint对media_files应排除原payload输出，加入实际octet_length(payload)/encode(sha256(payload),'hex')；完整dump恢复后再下载字节/hash验证，quarantine复用原grant/org/session禁用即可阻止全部媒体路径。

待root执行：完整最终strict/build/格式/源码、7PG、实际桌面/手机/HTTPS媒体播放+对时+撤销、全表重启和完整恢复、独立审查。外链未配置默认禁创建，不是假供应商联通；未实施转码/推流/收费视频或原生OBS。私有保险只是资料上传下载绑定名单，不更改requireInsurance开放限制，不声称承保审核或投保已完成。
