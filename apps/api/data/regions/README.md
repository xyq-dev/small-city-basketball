# 固定省／地级／县级地区目录

首版 `cn-admin-2025-r1` 来自 [yescallop/areacodes](https://github.com/yescallop/areacodes/tree/e2c2b2e1fb4ce1fb76e879aa0b80e229adaf950c) 的 `data/2025.txt`，按上游说明截至 2025-12-31。保留原 `LICENSE`（CC0 1.0）和原样保存的 `UPSTREAM_README.txt`；不能称为 2026 最新官方目录或官方全量认证。

3212 个真实地区：34 省级、333 地级、2845 县级。台湾、香港、澳门仅收录省级；直辖市和省直管县不虚造地级节点。目录不含乡镇、自然村、坐标、地图供应商代码或供给能力。

`manifest.json` 固定源提交／blob／SHA-256、许可校验、数据日期、规范节点／别名 hash。`registry.json` 保留首次导入的稳定身份；后续版本不可因年号变化重算既有 ID。原数据、registry 与 generated SQL 均随提交审查，不在运行时联网更新。

在仓库根运行 `node scripts/build-region-catalog.mjs --check` 只校验；明确传入 `--write` 才从固定源生成 registry、manifest、常量和新迁移。本命令不连接或操作任何数据库。已有迁移不可重写发布；后续目录更新须另建版本及追加迁移。

节点 hash 是按 `source_code` UTF-8 字节序排序的对象数组 `JSON.stringify`，对象键依次为 `regionId,sourceCode,name,level,parentRegionId`。别名 hash 是按 `label` UTF-8 字节序排序的数组，键依次为 `label,regionId,kind,provenance`。均为 UTF-8 SHA-256，对应 PostgreSQL `COLLATE "C"`。

别名只有 3148 个全量目录中唯一的正式名称和三个 C21 审定短名：广东、茂名、高州。28 个重复正式名称不入映射，不全局去后缀。旧数据只在查询时精确关联，不回填、更改原公开标签；地点仍以赛事说明为准。
