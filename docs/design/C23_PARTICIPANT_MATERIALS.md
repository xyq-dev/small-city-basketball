# C23 本人资料首版合同

2026-10-31 Asia/Shanghai；基线 main83ae15a；集成人 Codex root。DOC003 的最小可运行切片：既有球队成员本人资料、私有照片和外部保单人工审核。旧领队报名仍可用；不重做球队邀请、海报、季军赛、在线保险或支付。

## 规则与界面

仅 DRAFT 赛事可在原报名规则新增 `requireParticipantMaterials`（省略为 false，旧客户端兼容）。启用后，本届所有名单成员必须有本人绑定、实名资料、本人照片、当前规程签署和人工审核；`requireInsurance` 决定是否必须已有外部保单。此流程要求身份证号，格式校验不代表官方实名核验。旧 requireIdentity/requireInsurance 且未启用本流程仍拒绝开放；不把旧名单自动标为已合格。

启用本流程须服务器配置专用32字节 base64 `SCB_PARTICIPANT_DATA_KEY`；无配置时本人资料写入、规则开放均明确阻塞。生产和外部服务凭据不在本轮配置。测试仅用合成身份及自有隔离密钥。

本人入口由当前 ACTIVE team_member_bindings 确定 memberId。领队先按已有流程建立本届 entry 与 roster；本人保存草稿、上传照片、上传外部保单、确认规程、提交；独立组委会审核通过后，领队仍须提交队伍并经独立审核、冻结。审核通过不是领队名单提交或最终参赛资格。

本人页面和审核页分别显示未填写/草稿/待审/退回/通过/版本过期；网上投保显示未开放。领队只见逐人成员状态和阻塞，不得读取本人身份证、照片和保单。

## 数据与状态

新增 Migration024，不改001–023。新增个人材料 head 与不可变 revision 两表（最终表名/列以实施记录补充），head 按本届 entry/member 与 user 绑定。每次保存产生新 revision，包含精确 ruleset、roster revision、号码、规程签署版本、照片/保单版本和日期；head version +1，原审核失效。状态 DRAFT → SUBMITTED → APPROVED 或 CHANGES_REQUESTED；未冻结前重新保存回 DRAFT。没有静默转移已有材料给新绑定账号。

照片/证件/保单等私有内容全部进入 AES-256-GCM 认证加密 envelope，并绑定 org/event/entry/member/user/revision 的 AAD。身份证查重用专用 keyed HMAC；不用明文/无密钥散列。同届一个账号/身份不能绕过跨队重复规则。审计只记资源编号、版本和状态，不记原表单、证件、保单号或加密键。

只接受 JPEG/PNG 本人照片，沿用8MiB上限；完整解码、安全重编码、去除元数据且限制像素。保单接受 JPEG/PNG/PDF；图片同样重编码，PDF仅私有附件下载。原始图片不进入公开媒体接口。保存草稿支持资料缺失，正式提交必须有服务端已保存的照片；选择本地文件或未知结果不算成功。

PUT 草稿使用小写 UUIDv4 clientRequestId 和 expectedVersion（新建为0），回执唯一绑定本人、操作和资源；认证/当前绑定/资源权限先检查，然后查回执和比较请求指纹，回放不再产生 revision。原ID不同参数报冲突；不自动过期删除回执。提交/审核命令用 expectedVersion，响应未知后重新读取核对，不通过新请求强制覆盖。

照片或保单可分次保存，避免一次上传两个8MiB文件超过原请求体限制；省略字段保留已有内容，显式 null 清除可选文件/草稿字段。身份证界面默认脱敏，返回常规 DTO 不含完整证件/保单和文件base64；明确私有详情/文件操作重新授权并记审计。本地不持久化证件或文件base64。

## 访问与审核

每次操作重查登录、机构 ACTIVE、赛事、球队、当前 roster、当前 ACTIVE 绑定。本人只能操作自己；有权 OWNER/ADMIN 或 EVENT_MANAGER/REVIEWER 可审核；领队身份本身不授予材料私有读取权限。本人、当前队伍领队或该队活跃球员、队伍最后提交者不得审核本队资料。其他工作人员/观众/跨机构不可访问。

锁序保持 actor → org → event → team → entry → binding/material；写入与提交/批准/冻结在 event 锁下串行，不能出现冻结后替换资料。冻结后拒绝资料替换，保留冻结 revision 引用。宣传授权撤回是独立安全例外，可在冻结后执行，不改变参赛审核结果。

人工审核批准必须显式确认身份资料核对、本人照片核对，以及要求保险时的被保险人/篮球活动/保障期间。外部保单起止日期必须覆盖赛事当前起止；日期改变、规则/名单/号码/绑定变化、材料新版本均使原结论不能继续放行。拒绝宣传用途不影响参赛资格。

在队伍 SUBMIT、APPROVE、名单 FREEZE 三个服务端入口复查全部当前 roster 的本人资料和审核版本。capabilities 采用同一判定。只在完整新门槛就绪后替换旧的身份/保险开放拦截，不放宽独立队伍审核。资格费用规则不新增，不能把任意支付状态作为通过依据。

## API 路径（以本段为消费者合同）

统一前缀 `/v1/orgs/:orgId/entries/:entryId/participant-materials`。

- `GET /mine`：本人的常规脱敏 DTO，未建档为 data:null，并返回本人 memberId 与规则/能力上下文。
- `PUT /mine`：本人保存版本化草稿；字段含 clientRequestId、expectedVersion、realName、identityNumber、portrait、insurance、acceptedTerms、publicityConsent。文件对象 `{fileName,contentType,base64}`；insurance 含 insurer/policyNumber/startDate/endDate/document。省略保留旧值。
- `POST /mine/submit`：提交当前版本；`POST /mine/publicity-withdraw`：撤回宣传许可（仅影响未来使用）。
- `GET /`：主办方审核或领队进度，返回逐人脱敏状态、blockers、memberId/materialId/version，绝不含私有文件/完整证件。
- `GET /:memberId`：有权审核人读取常规 DTO。
- `GET /:memberId/private`：本人或独立审核人显式查看私有文字信息，记审计。
- `GET /:memberId/files/:kind`：本人或独立审核人授权读取 portrait/insurance，no-store/nosniff；不支持匿名链接。
- `POST /:memberId/review`：APPROVE/REQUEST_CHANGES、expectedVersion、reason，批准另需 identityChecked/portraitChecked/insuranceChecked。

## 留存与验证

目标留存为赛事归档/取消且结束90日后清除私有材料；诉争保留须显式标记。未实现/未验收清理能力前保持生产启用阻塞，不宣称有自动定时清理。密钥备份与数据备份分开；新 schema 旧包不能直接运行，须精确更新 readiness/运行最小权限/重启恢复清单。

独立复审订正：数据库保存非秘密 key-id，相关模块与 readiness 发现旧 key 失配须关闭写入，首版不支持静默轮换；名单/规则变化后显式 STALE 且必须本人重新勾选签署，不继承旧 true；head 的身份/账号占用仅当前有效 reservation，撤回/拒绝、移除名单或结束绑定后在同一 event 锁下释放，旧回放不复活占用；宣传撤回按原材料 user 重新授权，退出球队后仍可撤回；幂等指纹针对规范化原 patch，严格区分省略/null，不含后来的 head/名单或随机 nonce。取消/归档、WITHDRAWN/REJECTED 不允许常规写入。

本人发现补充：`GET /v1/me/participant-entries` 仅列本人当前活跃绑定且已在名单中的报名，返回 orgId/entryId/memberId/eventName/teamName/startDate/endDate 和规则要求。退出后原材料宣传撤回通过本人历史材料入口访问，不能借此重新获得球队或审核权限。

验收：本人/领队/审核人/跨机构隔离，图片解码与元数据，幂等回放与冲突，独立审核，三个门槛复检、改期/替换/冻结竞态、宣传拒绝/撤回不影响参赛、旧赛事回归、加密失败关闭、真实PG及页面API、三宽布局、精确恢复。官方微信/真机与生产各自标记，不以VM替代。
