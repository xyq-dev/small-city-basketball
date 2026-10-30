# C21 标准地区目录与旧城市标签兼容方案

2026-10-30（Asia/Shanghai）；负责人：Codex。状态：设计交付，待实施；不代表接口或数据库已变更。

基线：`main@406568891a8eb95219b962cbdcb7fa422b257f46`。上游要求：[DOC004](LOCATION_SERVICE_REQUIREMENTS.md)；已实现边界：[C20](../handoffs/C20.md)。本轮只设计手动地区选择和公开赛事筛选，不接 GPS、乡镇／自然村、地图、附近供给、支付或生产发布。

## 1. 首选与现状差异

首选：版本化的省／地级／县级目录，独立稳定地区 ID，服务端一次查询下级范围；保留旧 `city` 精确查询。旧上架记录不回填，只有无歧义的完整名称或经审定的精确别名在读取时关联地区。主办方更正通过同事务撤出旧记录并插入新记录，保持历史不可变。

| 已核验位置                                                       | 当前事实                                                                                       | 本次拟增加                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/api/src/directory-domain.ts`                               | `city` 经 NFC、空白归一化，1–20 字；仅精确匹配；游标 v1 绑定分组和城市                         | 地区 ID ＋目录版本查询及 v2 游标；旧规则原样保留          |
| `apps/api/src/directory-service.ts`                              | 单 SQL 联查有效机构、赛事、publication、ACTIVE listing；每 IP 每分钟 60 次；日期＋公开 ID 排序 | 同一 SQL 中加入地区树与唯一旧标签映射                     |
| `apps/api/src/directory-controller.ts`、`app.ts`                 | 匿名控制器不读取 Cookie，全局 `no-store`                                                       | 同样边界的公开地区目录                                    |
| `packages/contracts/directory.d.ts`、小程序 `utils/directory.js` | 匿名赛事严格八字段；前端额外字段也拒绝                                                         | 赛事八字段不增加；新建独立地区目录 DTO，私有目录 DTO 扩展 |
| Migration 018                                                    | 上架只能 ACTIVE→REVOKED，禁止删除／复活／改标签；一个赛事最多一个 ACTIVE；自动撤出在事务内执行 | 新地区列也不可变；更正仍使用旧撤出机制和新行              |
| `utils/city-preference.js`、`city-select`、home、watch           | 设备级 v1 字符串偏好，最近六项；切城与隐藏使旧响应失效                                         | v2 区分全国、标准地区、历史城市标签；不自动改变旧选择     |
| `event-setup/index.js`                                           | 确认前固定会话、版本、publication、listing；发送前复核；未知结果需重读                         | 标准地区选择和原子更正保持全部确认保护                    |
| readiness、权限清单、恢复脚本                                    | 精确核对 78 表、22 项迁移及权限；拒绝 SECURITY DEFINER                                         | 新表必须同步进入精确校验、备份、恢复和隔离验证            |

现有 C18 后端合同主要在 `packages/contracts/directory.d.ts`、源文件和 C18 设计中；根 API／DATA_MODEL 文档没有完整对应章节。实施时补充，不能把本设计的新合同写成当前已实现。

## 2. 地区范围与业务规则

| 选择   | 包含的标准归属                                                             | 不包含的内容                             |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------- |
| 全国   | 所有仍符合公开目录条件的赛事，含无标签、未知／歧义标签、暂无法映射的旧地区 | 未上架、撤出、停用机构、失效公开授权     |
| 广东省 | 广东本级及所有真实下级地区，包括茂名、高州                                 | 全国未知标签不能按猜测归入广东           |
| 茂名市 | 茂名本级及其下辖县区，包括高州市                                           | 只确定到广东的赛事；同名但不属茂名的地点 |
| 高州市 | 高州本级（本阶段最低县级）                                                 | 仅写“茂名”的粗粒度赛事；未知乡镇标签     |

“广东省 → 茂名市 → 高州市”是省／地级／县级三层。高州是县级市，不与茂名平铺成两个无关系的城市。选择上级表示“本级及下辖地区”；选择下级不能反推上级标签属于该下级。地区筛选不是空间边界计算，不证明服务可预约、户籍或参赛资格。

不强制三层完整：直辖市下直接选县区；省直管县级直接挂省级；东莞、中山、儋州、嘉峪关等真实地级叶子可完成选择。不得生成 `110100`、“市辖区”或“省直辖县级行政区划”等伪地区。界面可分组，分组没有可提交地区 ID。

主办方允许选择任意已支持的真实层级，以免假装知道更细地点；选择省级时明确“只按省归类，不会进入具体市县筛选”。只影响公开目录归属，不修改赛事场馆、个人资料、报名、订单地点或原分享地址。

## 3. 数据来源、覆盖与稳定身份

### 3.1 固定首版来源

使用数据维护者的一手仓库 `yescallop/areacodes`，不依赖地图 Key。已读取固定提交的 README、LICENSE 和完整数据，许可证为项目声明的 CC0 1.0，随数据保留原许可及来源。CC0 不替上游担保第三方权利；项目不冒充官方发布。

| 项                 | 固定值或核验结果                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 上游提交           | `e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c`                                                   |
| 原文件             | `data/2025.txt`                                                                              |
| Git blob           | `a31f53c95324bf8723be9f653bafce17bc253a61`                                                   |
| UTF-8 原文 SHA-256 | `73520f533c8e3f1aadb3bb55166656a491fb1e7703b2e2172e5694ec8845bab0`                           |
| 数据日期           | 按上游年份说明为 2025-12-31；不能写成 2026 最新目录                                          |
| 项目首版           | `cn-admin-2025-r1`，同时冻结地区树和别名表                                                   |
| 完整文件解析       | 3212 条、代码无重复：34 省级、333 地级、2845 县级                                            |
| 样例               | `440000 广东省`、`440900 茂名市`、`440981 高州市`                                            |
| 覆盖限制           | 台湾、香港、澳门仅有省级条目，没有下级数据；可选省级，明确下级未收录；不伪造全国完整三级覆盖 |

官方年版入口本次无法直接读取，未做官方全量比对。首版依上述公开快照实施，版本和覆盖限制必须展示／可查；不将这个限制转成“已验证最新”。已读取的官方编码管理规则支持省／地／县层级、代码变更与废码留存规则 [S4]。

实施时将原始文本、LICENSE、来源 manifest 和规范化 registry 放入 `apps/api/data/regions/`，不引入运行时依赖；生成器只读这些固定文件，不抓取远端、不连接数据库。原文件缺失或哈希不符停止导入。数据库种子由经验证的生成结果写入新 Migration，应用启动不自动拉取／改表。

### 3.2 ID 与层级生成

- `regionId` 为项目 UUID，显示名称是字段，六位来源代码是 `sourceCode`；未来地图 `adcode` 需独立映射，不能直接拿来授权或作为项目 ID。
- 首次导入确定性生成 UUIDv5：URL namespace 下对 `https://github.com/xyq-dev/small-city-basketball/regions` 生成命名空间 `494a6df2-5f24-5c6d-9949-9476ff74f5bd`，再以 `mca:<sourceCode>:2025-12-31` 生成 ID。固定 registry 随仓库保存，后续不能每年重算已有身份。
- 高州示例 ID：`5dbae224-8a72-5c66-8b2e-d6a7a9f312e3`；茂名：`2783ec7c-98f8-59e3-a07e-873888405c43`；广东：`5f394642-8fb8-5fef-9c4a-d52c9fe21747`。它们是公共参考身份，不是赛事／用户内部身份。
- 首版六位代码：后四位 0000 为省级，否则后两位 00 为地级，其余为县级。地级父为真实省级；县级优先真实地级前缀节点，若不存在则为真实省级。生成器必须验证父存在、父级更高、同省、无环、无孤儿，并对直辖／省直管／地级叶子作固定样例验证，不能仅凭名称含“市”判断层级。
- 同一名称可对应多个 ID。更名不自动新建身份；改隶、撤并拆分须核对官方对应关系，人工审定哪些延续、哪些创建新 ID。历史版本及 ID 不覆盖、不复用；无明确对应关系时保留未知状态。

### 3.3 受控更新

首轮只做上述固定版本，不写定时同步或通用管理后台。后续新版本走新数据提交及迁移审查：比较代码／名称／父级／身份／别名差异，新增版本记录并保留旧版本；任何别名改动也产生新 `catalogVersion`。服务端当前版本为发布包固定常量，所有实例必须一致。已有 listing 的地区快照不改写；查询以当前版本中相同稳定 ID 的真实树为准，缺失／退役身份不猜继承地区，只留全国或旧文字查询并在私有状态提示重选。区划更新造成的筛选变化需有发布说明。

## 4. 旧标签与客户端兼容

### 4.1 只读关联优先级

1. listing 有显式 `region_id`：仅采用该 ID。在当前目录不再可用时，不退回旧标签猜测；全国仍保留。
2. listing 无显式地区：对原 `display_city` 使用既有 normalizeCity，再查当前版本唯一旧标签表；不 UPDATE 原 listing。
3. 空、未知、多义标签没有地区归属；全国和原 `city` 精确查询保持可用。

旧标签表生成规则：当前版本的完整正式名称，仅当名称在全部地区中唯一时收录；另外首版只批准 `广东→广东省`、`茂名→茂名市`、`高州→高州市` 三条精确短名。每条人工短名保留来源目标、批准任务 C21、类型与理由。不批量去“省／市／区／县”，不模糊匹配、不根据机构所在地／IP／GPS／场馆猜测。重复名称（例如朝阳区）、别名与正式名称冲突必须从自动关联表排除并在生成检查中报告；搜索仍可列出多候选供人选择。

标准茂名筛选可返回旧标签“高州”或“高州市”的赛事；标准高州不能返回只有“茂名”的赛事。旧请求 `city=高州` 仍只查原文“高州”，不偷偷扩为“高州市”或整个茂名。不得改旧 API 语义来假装兼容。

这是标签的精确只读映射，不是人工核验举办地。标准地区列表固定显示“包含按历史城市标签匹配的赛事；以赛事地点说明为准”，不新增匿名赛事字段表示未经证实的位置精度。

### 4.2 本机偏好

新键 `scb.browseRegion.v2`，结构包含 `version:2`、`chosen`、`selected`、最多六个 `recent`；selected 为带判别字段的 `NATIONWIDE`、`REGION` 或 `LEGACY_CITY`。REGION 保存 ID、catalogVersion 与显示路径快照；LEGACY_CITY 保存原归一化字符串。显示快照仅用于离线提示，不作为新请求有效性依据。

首次升级先读有效 v2，否则将 v1 全国／字符串选择迁入内存的 NATIONWIDE／LEGACY_CITY；不自动换为标准地区。展示“上次按文字选择：高州，可改选广东省／茂名市／高州市”，须点击确认才切换。映射歧义或失败仍可继续旧查询或全国。版本变化重新取目录并核对稳定 ID；存在时明确显示“地区目录已更新，请确认”，不存在时保留旧显示并提示重选／全国，不能发出被猜出的地区请求。

v2 写失败保持本次内存选择并沿用 C20 的真实失败提示；旧存储不提前删除。成功选标准地区后也不把 ID 塞入 v1 字符串。旧版本小程序读自己的 v1 偏好，可能恢复升级前选择；不宣称跨客户端双向同步。清除最近选择需清除 v2 recent，并尝试清除 v1 recent，避免旧版历史复现；任一写失败均如实提示。当前选择不是最近历史的删除目标。

## 5. 数据模型与 Migration 设计（未编写、未执行）

**需要新 Migration**：显式归属必须落库并受引用约束保护，服务端地区树和唯一别名须与筛选版本一致；仅在客户端维护名称无法保证跨客户端及分页一致性。

新增三张全局公共参考表，均与业务授权隔离：

| 表／字段                  | 约束及用途                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region_catalog_versions` | `version text PK`、data_date、source_repo、source_commit、source_blob、source_sha256、license、normalized_sha256、alias_sha256、node_count、created_at；同版本内容不可改                                          |
| `region_catalog_nodes`    | `(catalog_version,region_id) PK`；source_code 六位字符串；name；level=PROVINCE/PREFECTURE/COUNTY；parent_region_id 可空；同版本 source_code UNIQUE；catalog FK、父复合 FK，父级更高且同省；省级父为空，其他父非空 |
| `region_legacy_aliases`   | `(catalog_version,label) PK`；region_id；kind=CANONICAL_UNIQUE/REVIEWED_ALIAS；provenance；复合 FK 指向 nodes；label 必须符合旧 normalizeCity；所有冲突不入表                                                     |

nodes 的层级、父、名字、来源只允许迁移身份插入，在 INSERT guard 中验证跨行规则；三个表均拒绝 UPDATE／DELETE／TRUNCATE，未来更新追加版本。数据、规范化树和别名哈希在发布包 manifest 固定；验收与 readiness 核对当前版本及规范化内容哈希，缺失／不一致拒绝 readiness，不能悄悄关闭新功能后继续返回错误目录。

`event_directory_listings` 只新增可空 `region_catalog_version`、`region_id`，两者必须同时 NULL 或同时非 NULL，并复合 FK 指向 nodes；不填默认地区，不执行历史回填。新增 ACTIVE listing 的 region_id 索引（部分索引）及需要的 ACTIVE display_city 索引；nodes 建同版本父索引。排序仍用原日期和公开 ID，不改业务时间。

新迁移中替换 guard 函数，保留 018 的所有原逻辑，增加两个地区字段不可变检查；不修改 001–022 原文件／checksum，不扩大可 UPDATE 列。不新增 SECURITY DEFINER、扩展、模糊检索或地理数据库。

`scb_runtime` 对三个参考表仅 SELECT，对 listing 保留原 SELECT／INSERT 及五个撤出字段 UPDATE；不授予新地区列 UPDATE、DELETE、全表 UPDATE。备份身份对三表 SELECT，仍不能锁行／写入；迁移身份负责种子。相应源码权限 manifest 和隔离授权测试属于后续实现必改项，实际生产权限配置本轮和实施提示词均禁止执行。

当前 22 项 Migration／78 表基线上拟为一项追加 Migration、81 表；编号执行前核验，暂称 `023_c21_region_directory.sql`，不是已创建文件。新增表精确计数／清单和已有其他任务冲突时重新核验，不机械替换数字或删除保护断言。

## 6. API 合同（拟议，尚未实现）

### 6.1 公共地区目录

新增 `GET /v1/public/regions`，不接受查询参数，返回当前完整小目录；一次取回后前端在内存中搜索／浏览，避免多组搜索分页。无登录、无 Cookie／Set-Cookie，`Cache-Control: no-store`；独立 `regions-ip` 限流 60 次／分钟／IP。不得将坐标、用户偏好或业务身份带入接口。

data 精确字段：`catalogVersion`、`dataDate`、`partialRootIds`、`regions`。每个节点仅 `id`、`parentId`、`name`、`level`，按 source_code 的固定顺序输出；partialRootIds 为港澳台对应省级 ID。meta 仅 requestId。地区参考数据不扩大匿名赛事 DTO。完整响应不得截断为看似完整；发布验收限制不超过 1 MiB UTF-8、不超过 10000 节点，超限需重新设计而不是静默漏项。

```json
{
  "data": {
    "catalogVersion": "cn-admin-2025-r1",
    "dataDate": "2025-12-31",
    "partialRootIds": [],
    "regions": [
      {
        "id": "5f394642-8fb8-5fef-9c4a-d52c9fe21747",
        "parentId": null,
        "name": "广东省",
        "level": "PROVINCE"
      },
      {
        "id": "2783ec7c-98f8-59e3-a07e-873888405c43",
        "parentId": "5f394642-8fb8-5fef-9c4a-d52c9fe21747",
        "name": "茂名市",
        "level": "PREFECTURE"
      },
      {
        "id": "5dbae224-8a72-5c66-8b2e-d6a7a9f312e3",
        "parentId": "2783ec7c-98f8-59e3-a07e-873888405c43",
        "name": "高州市",
        "level": "COUNTY"
      }
    ]
  },
  "meta": { "requestId": "example-only" }
}
```

上例仅截取广东路径说明结构；真实响应必须包含完整 3212 节点和实际三个 partialRootIds，不能照抄该样例当种子或完整响应。

搜索只在界面上找完整名称／全路径／上述三个明确短名，支持名称包含搜索并展示全部可区分候选；“包含”仅用于找候选，人必须点选 ID，不能用于服务端推断旧标签归属。每次渲染候选可分批，但原目录完整保留、可继续查看。首版不要求拼音、热门推荐或模糊纠错。

上述三个短名均为正式名称的子串，客户端名称搜索即可列候选，无需新增 alias 公共字段或硬编码地区 ID。后端的旧标签唯一关联仍只使用版本化别名表，不能复用前端包含搜索作为归属判断。

### 6.2 公开赛事查询与游标

保留 `GET /v1/public/directory`：旧 `status`、`limit`、`city`、`cursor` 的解析／默认值／返回值原样兼容。新增成对参数 `regionId`、`catalogVersion`；两者均出现才合法，不能与任何 `city` 参数并用（包括空字符串）。全国请求无 city、regionId、catalogVersion。

示例：

```text
GET /v1/public/directory?status=LIVE&limit=20&regionId=2783ec7c-98f8-59e3-a07e-873888405c43&catalogVersion=cn-admin-2025-r1
GET /v1/public/directory?status=LIVE&limit=20&city=%E9%AB%98%E5%B7%9E
GET /v1/public/directory?status=LIVE&limit=20
```

新地区模式在一个 SQL 语句／同一语句快照内递归取得当前版本的本级及下级 ID，LEFT JOIN 唯一别名，然后用显式 ID 优先、仅 NULL 显式 ID 时允许旧标签映射的谓词筛选。保持机构 ACTIVE、listing ACTIVE、publication 未撤销、赛事状态／purpose／format 的全部原条件。唯一别名键确保每个 listing 只产生一行；不使用客户端 N 城请求合并或分页后再过滤。

匿名赛事 data **仍严格只有** `publicEventId,name,startDate,endDate,venueName,status,purpose,displayCity` 八字段，meta 保持 requestId／nextCursor。displayCity 是既有公开标签：历史值不改，新的标准上架使用正式地区单名。没有内部 org/event/listing/user ID、操作者、理由或坐标。

| 模式          | 游标与升级兼容                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 全国／旧 city | 继续签发并接受 v1 `{v:1,s,c,d,k}`；不绑定新目录版本，不因上线 C21 强制过期                                                      |
| 标准地区      | v2 `{v:2,s,r,g,l,d,k}`；r=regionId、g=catalogVersion、l=limit、d/k=原日期／公开 ID；固定 JSON 字段顺序、base64url、512 字符上限 |

v2 校验完整键集合、版本、有效日期、公开 ID、limit、当前分组／地区／目录版本，并重新编码逐字匹配；v1 不能用于地区请求，v2 不能用于旧模式。目录版本过期先返回 `REGION_CATALOG_CHANGED`，清掉旧分页后重选／确认；其他筛选错配返回 `INVALID_CURSOR`。游标不签名、不授予权限；结构合法地改写分页位置可能跳项，但不能越过每页的公开过滤，不能宣称任意篡改都可检出。

沿用 LIVE／UPCOMING 按 start_date 升序、HISTORY 按 end_date 降序，第二排序公开 ID `COLLATE C ASC`。列表是实时 keyset 分页，不是冻结快照：并发上架／更正可能在已读边界前出现，刷新第一页可重读；撤出不会在之后页重新出现。不能承诺跨页期间所有变化零漏项，前端只做原公开 ID 去重，不能代替服务端筛选。

### 6.3 主办方命令与更正

沿用 `GET .../directory` 和 `POST .../directory-commands`，路径前缀为 `/v1/orgs/{orgId}/events/{eventId}`。权限仍是机构 owner/admin 或该赛事有效 EVENT_MANAGER，不添加平台／跨机构能力。

LIST 两种合法输入互斥：旧 LIST 原样接受 displayCity 或不填地区；新 LIST 携带 `region:{catalogVersion,regionId}`，禁止同时带 displayCity，服务端使用所选节点的正式单名写入 display_city。首版全部正式名称已核验最长 15 个字，满足旧 20 字规则；后续版本超限必须审查展示合同，不截断名称。UNLIST 原合同不变，不接受地区字段。

新增 `REPLACE_REGION`，只适用于当前 ACTIVE listing：

```json
{
  "type": "REPLACE_REGION",
  "expectedEventVersion": 12,
  "expectedListingId": "11111111-1111-4111-8111-111111111111",
  "region": {
    "catalogVersion": "cn-admin-2025-r1",
    "regionId": "5dbae224-8a72-5c66-8b2e-d6a7a9f312e3"
  },
  "reason": "确认赛事举办地为高州市"
}
```

命令不接受 displayCity；region 不可空，不能用新命令清空地区。需要撤出或按旧文字重新上架时仍走旧明确流程。保持旧 LIST 与 UNLIST 的验证／错误码；未知字段一律拒绝。

事务顺序：身份 → 机构 → 赛事（锁并检查 expectedEventVersion）→ 当前 publication→listing（检查 expectedListingId、ACTIVE、权限和状态）→ 核验当前地区版本与节点。先将旧 listing 撤出，revoke_source 使用既有 UNLIST、保留用户 reason；再插入同一 publication 的新 ACTIVE listing，写入新地区和正式单名；touch 赛事版本**一次**，listed_event_version 为更新后版本。audit 在同事务记录 `directory.region_replaced`、旧／新 listing、旧／新标签和地区、理由及赛事版本。任何插入／审计失败全部回滚，不存在已撤旧却没上新的提交。

新行不能复用旧 ID、listed_at、listed_by 或原上市版本；共享 publicEventId 保持不变，因此分享链接继续可用。旧行及其原标签／地区永久保留。明确告知用户：“确认后按高州市归类并显示高州市，原‘高州’文字筛选可能不再找到这一条；全国、标准地区和分享链接仍可访问。”这是主动更正，不承诺旧文字查询在标签被用户修改后仍找到同一条。

同一显式 ID／当前版本、且现有正式标签已一致时返回 `DIRECTORY_REGION_UNCHANGED`，不新建历史、不增版本。与关闭公开观赛、完赛／重开、发布下一轮、隔离恢复或停用机构并发时必须保留既有锁序／触发器规则；最终撤出后不得留下 ACTIVE 或自动重上架。新目录表不参与业务权限判断。

私有 listing DTO 增加 `region:{catalogVersion,regionId}|null`；私有 EventDirectoryData 增加 `regionCatalogVersion` 和 capability `canReplaceRegion`。新 capability 为 manager ＋ ACTIVE listing ＋当前有效 publication／group，不改变旧 capability 的含义。旧客户端忽略这些附加私有字段；必须用旧客户端解析器测试，不能仅假设忽略。

确认前固定账号、页面／确认代次、版本、listing、publication、所选地区和目录版本；返回及发送前全部复核。请求发出后失去会话仍丢弃响应，不能称未执行。沿用未知结果恢复：重读私有目录与版本判断实际状态，不自动生成新请求或悄悄重放；本轮不引入新的幂等命令合同。

### 6.4 错误与恢复

| HTTP／code                        | 条件与动作                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 400 INVALID_QUERY                 | 地区参数不成对、与 city 并用、重复／未知查询参数或格式不符；修正请求         |
| 400 INVALID_CURSOR                | 游标结构、模式或当前筛选不一致；从第一页重读                                 |
| 400 INVALID_REGION                | 格式正确的 ID 不在当前可选目录；重新选地区，不返回伪空赛事                   |
| 409 REGION_CATALOG_CHANGED        | 请求／命令目录版本不是当前发布版本；重新取目录、人工确认，不能自动重发写请求 |
| 409 DIRECTORY_LISTING_CHANGED     | 更正目标已撤出或换成另一 listing；重读并重新确认                             |
| 409 DIRECTORY_REGION_UNCHANGED    | 重复更正为完全相同的标准归属；只提示现状                                     |
| 原 VERSION_CONFLICT／其他目录错误 | 维持既有权限、状态、原因校验和未知结果处理                                   |
| 429 RATE_LIMITED                  | 沿用已核验 `service.ts` 的公共限流错误码；保留当前选择，稍后手动重试         |
| 503 REGION_CATALOG_UNAVAILABLE    | 当前版本未就绪或校验不一致；不能伪装成成功空目录或自动换全国                 |

拟议新增错误码实施时加入共享合同／测试。既有 rateLimit 已返回 RATE_LIMITED，不能为了新功能修改既有错误合同。

## 7. 页面与状态

city-select 增加完整路径、层级浏览、名称搜索、当前选择、最近六项和全国入口；省／地级每层都有“选择本地区及下辖地区”。同名结果必须显示上级路径。目录加载／失败／重试、部分覆盖说明与历史文字选择明确区分；首次打开不定位、不强制登录，不改变 C20 全国默认。

首页与 watch 共享 REGION／LEGACY_CITY／NATIONWIDE 状态。标准地区顶部显示完整路径和“含下辖地区”；旧文字模式标注“历史城市标签精确筛选”。更改 mode、ID、catalogVersion、group 或回到页面均重新第一页、更新代次；旧第一页／翻页响应不得落到新筛选。后续页失败保留已成功部分并显示失败，不把它当加载结束；INVALID_CURSOR 或目录版本改变提供显式重读。

event-setup 在目录卡内选标准地区，旧 listing 显示原公开标签和当前归属建议／显式归属。浏览选择与主办方编辑选择使用不同上下文：在设置页选地区不能改变首页偏好，浏览页切城不能改表单。可复用 picker 组件／路由，但需独立返回结果通道及操作代次。更正弹窗并列原标签、完整新路径和影响说明，保持 ui.confirmOp。

不在定位按钮未接入时调用任何位置接口，不展示距离，不把地区有赛事等同当地服务已开放。分享直达按原授权打开，浏览地区不限制链接，也不自动被链接改写。

## 8. 迁移、发布顺序与回退边界

本节是未来实施／发布设计，**本轮 Migration 未编写、未执行，生产无操作授权**。

1. 实施先固化来源、许可、registry／唯一别名及哈希；新增迁移和契约，写隔离测试。旧记录新增列全部 NULL，迁移不触发 LIST、UNLIST、改名或版本变更。
2. 先在新建隔离库验证全量迁移；另从 001–022 合成库升级，逐行核对原 listing、publication、event version、audit 不变（仅新增 NULL 列），重复运行迁移 runner 无重复执行。
3. 必须同步 `runtime-privileges.json`、readiness、privileges、备份／恢复／重启检查和 P07 测试。参考表归备份范围；恢复隔离依旧撤销 publication 并触发撤出 listing，不重列任何赛事。
4. **旧后端不能直接运行新 Schema**：现有 readiness 精确匹配迁移／表／权限，所以新增表即使可空，也不等于支持旧二进制滚动运行。未来正式发布须安排受控维护窗口，先停旧写入、保留旧包与已验证备份，再用匹配新版本执行迁移及权限部署、启动新后端通过 readiness，最后发布小程序。该步骤未获本轮执行授权。
5. API 向后兼容指“新后端服务旧客户端”，不指“旧后端可连新库”。新小程序遇到旧后端返回未知参数时明确提示服务未升级，不静默降级到省名文字筛选。
6. 回退首选保留新 Schema 的修复／兼容包，不 DROP 新表／新列，不修改旧迁移 checksum；新写入产生后不可用旧备份无损覆盖。恢复至旧包只能恢复对应旧备份到独立隔离库并核验，会丢失备份后的数据，不在本轮授权内。
7. 旧 78 表归档用保留的 C20 对应恢复包还原到自有隔离库、校验指纹与隔离，再由新包升级和重新授权；新 81 表归档由匹配新包恢复。不能让新版 restore 通过仅放宽表数量接受任意旧归档，不能删除精确表名／迁移／哈希／权限保护。当前恢复归档格式 version 1 可保留；兼容范围由匹配发布包限定并写明，不新增通用恢复框架。

## 9. 精确实施范围和顺序

| 阶段           | 允许修改的模块／文件                                                                                                                                                                                              | 交付                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A 数据         | 新 `apps/api/data/regions/`、`scripts/build-region-catalog.mjs` 及直接测试                                                                                                                                        | 固定 CC0 来源、哈希、稳定 registry、父树、唯一别名；无运行时联网 |
| B 数据库与边界 | 一项新增 migration；`packages/contracts/runtime-privileges.json`；`apps/api/src/readiness.ts`；`ops/db/privileges.mjs`；`ops/recovery/{backup,restore,fingerprint}.mjs` 及直接测试；重启／production 检查相关断言 | 精确增加三表、两列和 seed，不放宽旧保护；保持旧包恢复路径        |
| C 合同与服务端 | 新 `packages/contracts/region-catalog.d.ts` 与 index 导出；directory.d.ts；新 region-catalog domain/service/controller 及 app 注册；directory-domain/service/controller；直接测试                                 | 公开地区目录、地区筛选、旧 v1 保留、原子更正                     |
| D 小程序       | `utils/{api,directory,city-preference}.js`，新目录辅助模块；`pages/{city-select,home,watch,event-setup}/*`，直接测试／fixture                                                                                     | 标准层级选择、偏好升级、独立编辑选择、迟到保护                   |
| E 联合验证     | `apps/api/test/c18-directory.integration.test.ts` 保留；新增地区 integration；小程序新回归；`tests/wechat-api/event-platform.test.mjs`；兼容布局 fixtures；P07／重启恢复验证                                      | 真查询、并发、未知结果、权限及恢复证据                           |
| F 文档         | 根 API_CONTRACTS／DATA_MODEL、微信 README、新实施任务及交接、本文实施注记                                                                                                                                         | 计划和实际分开，证据完整                                         |

现有 78／22 计数存在于 `apps/api/src/readiness.ts`、`ops/db/privileges.mjs`、`ops/recovery/backup.mjs`、`restore.mjs`、`scripts/check-production.mjs`、`scripts/check-database-restart.mjs` 及 P07 测试；实施按依赖查漏，不用全仓无差别字符串替换。按既有隔离 CI 验证必要包装／恢复不等于正式 pack 或生产部署。

不改 AGENTS、既有 Migration、核心权限模型、订单／支付／记分状态机、无关 Web 页面、依赖锁或工作流；如确需这些变化，报告具体冲突再收窄处理。契约负责人由实施集成人明确，CURRENT_STATUS／TASKS 仍集成人单写。

## 10. 验收矩阵（全部为待实施测试）

| 编号 | 必测场景        | 断言与层级                                                                                                      |
| ---- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| R01  | 来源与生成      | 固定提交／blob／SHA-256、许可、3212 唯一代码、两次生成完全相同；损坏源拒绝；unit                                |
| R02  | 真层级          | 广东 → 茂名 → 高州、北京直挂、济源省直管、东莞地级叶子、港澳台仅省级；无伪节点／孤儿／环；unit ＋ API           |
| R03  | 全国与父子范围  | 省含市县，茂名含高州，高州不含“茂名”粗标签；未知／空／歧义只在全国及旧精确模式可见；真实 PG                     |
| R04  | 旧标签          | 高州／高州市映射同一标准地区；朝阳区不猜；“高州·石鼓”不截取前缀；没有历史 UPDATE；真实 PG                       |
| R05  | 旧合同          | 原 LIST／UNLIST、city 精确匹配、原默认值、v1 首／续页、旧私有解析及匿名八字段逐键一致；旧客户端测试             |
| R06  | 新目录          | 完整节点、正确三项部分覆盖、响应小于 1 MiB、无 Cookie／Set-Cookie、no-store、限流、错误不等于空；HTTP           |
| R07  | 游标            | 跨省／市／组／版本／limit、v1/v2 混用、未知键、无效日期拒绝；每页仍检查公开权限；unit ＋ PG                     |
| R08  | 服务端分页      | 同日期多事件跨页无重复；父区聚合的标签和显式归属不 JOIN 膨胀；撤出即后续不可见；真实 PG                         |
| R09  | 新上架          | 新地区 LIST 写正式单名、地区 FK、event version／audit；旧 LIST 地区为空并兼容；真实 PG                          |
| R10  | 原子更正        | 旧记录永久保留，新 ACTIVE 恰好一条，版本仅＋ 1，分享身份不变；强制插入／audit 失败全回滚；真实 PG               |
| R11  | 并发撤出        | 更正与更正／UNLIST／DISABLE／完赛重开／发布轮次／停用／quarantine 对撞；按实际锁序串行且没有复活／死锁；真实 PG |
| R12  | 权限／DB 防绕过 | 跨机构与无 EVENT_MANAGER 拒绝；runtime 不能改参考表、地区列或删历史；backup 不可锁行／写入；P07                 |
| R13  | 迟到确认        | 账号切换／退出／卸载、新确认、版本／listing／publication／地区选择改变均实际写请求 0；正常仅 1 次；页面 VM      |
| R14  | 未知结果        | 更正成功后响应丢失，重读新 listing／版本，不能新编号重放或谎称取消；真实页面 →API                               |
| R15  | 偏好与失效      | v1 三种标签迁移不自动选 ID，v2 错误恢复、写失败冷启动、清历史部分失败、目录变化重选；unit                       |
| R16  | 页面隔离        | 首页／watch 同步，设置页选地不改浏览偏好，浏览选地不改表单；分享直达不受筛选限制；VM ＋真实 API                 |
| R17  | 迟到列表        | 改地区／全国／旧文字／分组、隐藏／卸载、翻页失败、目录更新／游标失效，旧回调不混入新数据；VM                    |
| R18  | 全新迁移／升级  | 空库、001–022 含旧 listing 合成库、重复 runner；原数据／权限规则保留，NULL 不回填，checksum 不变；隔离 PG       |
| R19  | 包与恢复        | 新版精确表／权限／迁移数、重启及完整备份恢复；旧版归档用旧包隔离恢复后升级，新版不盲收旧归档；不写生产          |
| R20  | 公开撤销        | 下架／停用后全国、地区、旧文字均消失；单纯撤目录分享仍开，关闭公开观赛旧链接不可用；真实 API                    |
| R21  | UI 与不可用     | 320／390／430 全路径、同名、两级树、错误／空／部分覆盖、最近选择；兼容布局实际 PNG 及守卫                       |
| R22  | 真微信          | 官方工具、iOS／Android 选地／返回／存储失败；有通道才执行，未做单列，不用浏览器替代                             |

实施必须执行针对性 unit、相关真实 PG、C18 ＋ C20 ＋新增小程序回归、真实页面 API 主线、三宽布局、格式／类型／构建和数据库边界要求的隔离 CI。历史 CI 不计入新验收；全量 CI 按仓库流程执行一次最终候选，失败修复后只按实际需要重跑。纯设计交付本轮不运行这些业务测试。

## 11. 已完成的设计核验与后续入口

本轮实际读取源码与数据库 guard，核验了上游完整文件、许可、哈希、条数、地区示例及最长名称。没有实现任何拟议接口或迁移。文档检查和提交／PR 状态见 [任务](../tasks/C21.md) 和 [交接](../handoffs/C21.md)。后续采用 [Claude Code 实施提示词](../agent-prompts/C21_CLAUDE_IMPLEMENTATION.md)，另建实施任务；该提示词需用户下达后才执行，本轮授权不自动扩展。

## 12. 来源与边界

- S1：[固定来源说明](https://github.com/yescallop/areacodes/blob/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/README.md)。年份口径及上游官方来源声明已读。
- S2：[固定数据文件](https://github.com/yescallop/areacodes/blob/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/data/2025.txt)。本轮完整读取并解析；未经官方全量认证。
- S3：[固定 CC0 许可](https://github.com/yescallop/areacodes/blob/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c/LICENSE)。已读，不额外引入地图数据许可。
- S4：[国务院公报：行政区划代码管理办法](https://www.gov.cn/gongbao/2025/issue_12226/202508/content_7036972.html)，[司法部转载](https://www.moj.gov.cn/pub/sfbgw/flfggz/flfggzbmgz/202512/t20251204_528920.html)。搜索实际取得原文；直接打开司法部页面出现重定向错误，未隐瞒读取方式。代码是来源属性，废码不能复用，旧版本保留。
- S5：[国家地名信息库年版入口](https://dmfw.mca.gov.cn/XzqhVersionPublish.html)。上游列为 2025 年来源；本轮直接访问失败，不能当作已全量核对。
