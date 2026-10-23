# P07-A 自托管包安装与隔离恢复

本目录是Linux主机的安装模板。当前交付仍需实际Docker／TLS／恢复CI验收，不代表已部署生产。完整范围与验收见[任务卡](../../docs/tasks/P07-A.md)，源码交接见[打包记录](../../docs/handoffs/P07-A-package.md)。需要已提供的主机、Docker Engine＋Compose plugin、域名／受信TLS证书及受控私有目录；这些设施没有随仓库自动配置。以下使用rootful Docker与固定容器UID，rootless／user namespace remap须先独立验证实际映射，不能放宽secret权限代替。

## 镜像与入口

在仓库根目录运行所有Compose命令；示例使用项目名`scb`，更换后须保持一致。`--env-file`提供路径与非敏感设置，所有密码／DSN／owner输入均单独挂载文件。不要设置对应inline环境变量；同名`*_FILE`与inline并存会失败。

| target／镜像后缀              | 运行身份／工作目录  | 内容与默认入口                                                                           |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `api`／`/api:local`           | 10001:10001，`/app` | Node24.22.1、compiled API、SQL、contracts、生产依赖；`node apps/api/dist/main.js`        |
| `web`／`/web:local`           | 101:101             | nginx1.30.6、API模式静态包；`/opt/scb/web-entrypoint.sh`                                 |
| `db-tools`／`/db-tools:local` | 10001:10001，`/app` | PG18.6客户端、同架构Node24.22.1 musl、生产依赖、compiled入口、SQL、manifest及实际ops脚本 |

内部`build` target仅用于构建／CI验证，含源码与开发依赖，不是生产运行镜像。生产三镜像不包含TypeScript源、测试、tsx或Vite。Web静态目录`/usr/share/nginx/html`只读；运行配置、pid、缓存均在`/tmp/scb-nginx`。仅Web发布8443；API3300与PG5432没有host端口。PG18卷挂`/var/lib/postgresql`。不要在上游再加第二层反代；本包固定单跳、`TRUST_PROXY_HOPS=1`。

## 准备私有配置与文件

复制[环境模板](production.env.example)至仓库外，例如`/srv/scb/production.env`，权限0600。设置真实`APP_ORIGIN`及路径；本Web入口支持canonical小写DNS／IPv4＋可选非默认端口，例`https://basketball.example.com:8443`，无末尾斜杠、路径、userinfo、query、fragment。HTTPS443使用不带`:443`的origin。当前模板不支持IPv6 authority。host映射端口必须与公开origin一致，或由明确的主机NAT把公开端口映射至该端口；不要自行增加代理hop。

以下是文件内容约定，所有DSN中密码须URL编码，禁止直接照抄占位符。source四个DSN的host／port／database必须完全一致，分别使用固定角色；`database_admin_url`的密码与PG初始化密码相同。源集群Compose内地址为`postgres:5432`，database与`POSTGRES_DB`一致。

| 文件名                               | 私有内容                                                      | 宿主owner／mode   |
| ------------------------------------ | ------------------------------------------------------------- | ----------------- |
| `postgres_admin_password`            | scb_admin原始密码，供PG初始化入口                             | root:root／0400   |
| `database_admin_url`                 | `postgresql://scb_admin:<encoded-password>@postgres:5432/scb` | 10001:10001／0400 |
| `database_migrator_url`              | 同endpoint，用户scb_migrator、独立密码                        | 10001:10001／0400 |
| `database_runtime_url`               | 同endpoint，用户scb_runtime、独立密码                         | 10001:10001／0400 |
| `database_backup_url`                | 同endpoint，用户scb_backup、独立密码                          | 10001:10001／0400 |
| `bootstrap_owner_input`              | [严格JSON模板](bootstrap-owner.example.json)，换成新私有值    | 10001:10001／0400 |
| `tls_certificate`、`tls_private_key` | 有效PEM fullchain与匹配私钥                                   | 101:101／0400     |

先在受控私有暂存目录准备这些文件，不经命令行传递秘密值，不提交仓库，不开启shell trace。以下命令只安装已有私有文件，不生成凭据；`SCB_PRIVATE_STAGE`须指向你准备的绝对目录：

```sh
sudo install -d -m 0700 -o root -g root /srv/scb /srv/scb/secrets
sudo install -d -m 0700 -o 10001 -g 10001 /srv/scb/archive
sudo install -m 0400 -o root -g root "$SCB_PRIVATE_STAGE/postgres_admin_password" /srv/scb/secrets/postgres_admin_password
for name in database_admin_url database_migrator_url database_runtime_url database_backup_url bootstrap_owner_input; do
  sudo install -m 0400 -o 10001 -g 10001 "$SCB_PRIVATE_STAGE/$name" "/srv/scb/secrets/$name"
done
for name in tls_certificate tls_private_key; do
  sudo install -m 0400 -o 101 -g 101 "$SCB_PRIVATE_STAGE/$name" "/srv/scb/secrets/$name"
done
sudo install -m 0600 -o root -g root ops/templates/production.env.example /srv/scb/production.env
# 在私有编辑器中完成production.env；不要打印secret内容。
```

若操作者不能读取root私有env，后续Compose命令也须用相同受控sudo环境执行。Compose file-backed secret直接bind宿主inode，`uid/gid/mode`长语法不能修复宿主owner。不要chmod0644或把API改root；必须实际验证10001／101可读自己的挂载。TLS证书也按私有权限存储。所有目录须提前存在；archive不会由Compose自动创建。

## 首次启动与首位owner

```sh
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml config --quiet
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml build
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml up -d
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml ps -a
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml --profile ops run --rm --no-deps bootstrap-owner
```

启动链为PG健康→provision建角色→migrate显式执行compiled迁移并应用权限→API `/ready`成功→Web。API启动本身不迁移／seed。首次provision须使用新空PG卷；修改初始化密码文件不会重设已有卷密码。默认机构注册关闭、participant注册开启；没有邮件投递／邮箱验证。owner CLI只允许全库零机构时原子创建首owner、机构、OWNER membership与审计；成功不返回session或token。已有机构／同邮箱不提升或重置密码。完成后将owner输入移出日常secret目录；它只被该手工job挂载，正常up不需要读取它。

使用受信证书访问`${APP_ORIGIN}/ready`，应返回成功。生产不要跳过TLS验证。`/health`仅表示连接；`/ready`还核验迁移checksum、扩展、runtime身份与ACL。`/overlay`、`/watch`和私有深链由SPA接管，`/v1`错误保留API状态。Web覆盖外来转发头，访问日志关闭以避免记录授权URL；API只持runtime secret。

更新包时先停Web／API并暂停全部外部writer，按下一节完成静止备份，再build；用显式job重新执行provision／migrate，而非指望已退出的旧job在每次up自动重跑：

```sh
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml stop web api
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml build
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml run --rm --no-deps provision
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml run --rm --no-deps migrate
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml up -d --no-deps --force-recreate api
# 等待API healthy后再启动Web；失败则保持入口关闭。
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml up -d --no-deps --force-recreate web
```

001–015的实际生产迁移／角色权限须由真实CI和目标环境验收记录证明，本说明中的命令不是执行证据。不要`down -v`删除持久卷；容器重启持久性也不是备份恢复验证。

## 静止备份

先停止Web/API并暂停owner、脚本或其它所有writer。在同一静止区间采集全库／业务基线，再dump，dump完成前不允许其它提交。本卡没有导出MVCC snapshot／PITR机制；日常pg_dump本身一致不能证明晚取基线对应同一时点。每次使用新的文件名，不覆盖旧dump：

```sh
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml stop web api
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml --profile ops run --rm --no-deps -e ARCHIVE_PATH=/backups/scb-20261022-001.dump backup
```

archive父目录0700，dump由10001创建0600，不上传CI artifact或提交Git。源backup角色只读，无DDL／行锁UPDATE。备份后的开启入口是单独运维决策。首卡不提供异地存储／自动轮转策略；同机私有目录不能替代异地灾备。

## 恢复至全新隔离目标

`SCB_RESTORE_SECRET_DIR`始终是独立目标目录，默认`/run/scb-restore-secrets`，绝不回落源secret。restore／quarantine只加入独立`scb_recovery` bridge，不加入source backend。目标须是另一个自有PG18.6实例／卷，host可达；CI可将目标容器以alias`restoredb`接此network。不要发布PG端口到公网。目标roles先用同一provision脚本初始化，四个target角色URL须同host／port／存在的controlDB（通常`postgres`），不能复制source DSN。

| 目标目录文件            | 内容／权限                                          |
| ----------------------- | --------------------------------------------------- |
| `database_restore_url`  | 目标scb_admin连接controlDB，10001:10001／0400       |
| `database_migrator_url` | 同target/controlDB的scb_migrator，10001:10001／0400 |

目标provision另需target admin／runtime／backup三角色URL；可在准备目标的私有环境使用db-tools直接运行，所有文件按相同10001／0400安装。示例仅说明mount接口，`SCB_TARGET_SECRET_DIR`须为准备的目标私有目录，`scb_recovery`须已由Compose创建，目标PG须已接入；此处target目录的`database_admin_url`与restore目录`database_restore_url`连接同目标管理员/controlDB：

```sh
docker run --rm --init --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 --network scb_recovery \
  --mount "type=bind,src=$SCB_TARGET_SECRET_DIR/database_admin_url,dst=/run/secrets/database_admin_url,readonly" \
  --mount "type=bind,src=$SCB_TARGET_SECRET_DIR/database_migrator_url,dst=/run/secrets/database_migrator_url,readonly" \
  --mount "type=bind,src=$SCB_TARGET_SECRET_DIR/database_runtime_url,dst=/run/secrets/database_runtime_url,readonly" \
  --mount "type=bind,src=$SCB_TARGET_SECRET_DIR/database_backup_url,dst=/run/secrets/database_backup_url,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/database_admin_url \
  -e DATABASE_MIGRATOR_URL_FILE=/run/secrets/database_migrator_url \
  -e DATABASE_RUNTIME_URL_FILE=/run/secrets/database_runtime_url \
  -e DATABASE_BACKUP_URL_FILE=/run/secrets/database_backup_url \
  small-city-basketball/db-tools:local node ops/db/provision.mjs
```

准备目标私有secret目录及角色后，指定全新`scb_restore_*`数据库名和新receipt文件名：

```sh
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml --profile ops run --rm --no-deps \
  -e ARCHIVE_PATH=/backups/scb-20261022-001.dump \
  -e RESTORE_DATABASE_NAME=scb_restore_20261022_001 \
  -e RESTORE_RECEIPT_PATH=/backups/scb-20261022-001.restore.json restore
# 此时先独立完成阶段1：58表／schema／checksum／业务指纹等于同一静止备份点。
# 恢复使用与备份相同的代码/Migration版本；P07-A的39表旧包须用该版本恢复，
# 不用新包隐式升级旧备份，恢复与显式Migration分开执行。
docker compose --env-file /srv/scb/production.env -p scb -f compose.production.yaml --profile ops run --rm --no-deps \
  -e RESTORE_RECEIPT_PATH=/backups/scb-20261022-001.restore.json quarantine
```

restore只CREATE全新库，完整custom archive、single transaction、no-owner/no-acl，然后重应用manifest；不覆盖已有库、不先迁移再data-only、不禁触发器。失败留目标库供当前project负责人检查／清理，不任意DROP。receipt0600含目标name／OID／nonce，quarantine核DB comment匹配后才执行。第一阶段恢复相等与第二阶段隔离的预期变化分别验收，不能将重启当恢复。

quarantine撤销旧session／pending invitation／active public／active overlay，过期有效lease，禁用全部机构及平台运营资格、撤销微信身份并删除旧挑战，保留系统主体审计；它不自动恢复当前授权、不重开机构、不修改比赛赛果／fence身份。终点是旧凭据失效的隔离目标，后续依据外部当前授权清单人工核验后另行开放与切流。不能声称fence超过备份后丢失的未知值、RPO为零或已实现生产灾备。原生OBS／CEF和真实推流仍未验收。

网络边界：仅Web连接可发布主机端口的`ingress`桥，同时接入internal `frontend`反代API；API仅连接internal `frontend`/`backend`，PostgreSQL仅internal `backend`，两者均无主机端口。`internal`网络不能替代Web发布入口；隔离CI将Web绑定到`127.0.0.1:9443`，不会开放公网。

## C05 商业、微信与媒体运行接口

默认 `COMMERCE_MODE=OFF`，保留既有办赛使用；每次首次正式发布记录 UNMETERED 激活。开启 `ENFORCED` 后，首次发布需要与本届绑定、有效且覆盖整届队数/预计场次的已付软件服务权益；已激活赛事不因后续到期中断。013 为升级前已发布赛事写 LEGACY 激活。这里仅处理平台按届软件服务费，没有报名费、保证金、钱包或托管资金。

平台运营资格独立于机构负责人。先创建真实应用账号，核验人员，再以维护身份运行 `platform-operator` profile 服务；它只读取私有 `platform_operator_input` JSON（[模板](platform-operator.example.json)，10001:10001、0400/0600、普通文件、禁止符号链接），记录维护身份及原因。模板默认 DISABLED，实际开通需显式 ACTIVE。运行服务为 `docker compose --env-file <existing-private-env> -p <verified-project> -f compose.production.yaml --profile ops run --rm --no-deps platform-operator`。先核验目标环境与当时授权；本次只编写及隔离测试，没有生产执行。人工收款与退款要求两位不同平台操作员，复核人不能是订单创建人或目标机构有效成员；缺人时保持待复核。

微信登录与真实微信支付均默认禁用。原生客户端源码在 `apps/wechat/`，需要实际主体、AppID、合法请求域名及真客户端验证。登录绑定仅针对已有账号，使用当前密码复核；微信身份不自动创建虚假邮箱、不合并不同账号。

已有资质和凭据齐全且另获部署授权后，可分别审查并使用 [微信配置覆盖](compose.wechat.yaml) 或 [Native 支付覆盖](compose.wechatpay.yaml)。它们只给 API 增加出站网络，不发布 API/PG 端口；基础包仍只有 internal 网络。私有凭据文件置于既有 `SCB_PROVIDER_SECRET_DIR`，10001:10001、0400；不提交 Git、不打印。支付公钥文件是 serial→PEM 的受信 JSON 映射，仅接受运营方核验过的公钥，不从未经认证的下载建立信任。支付通知固定同源 `/v1/payments/wechat/notifications`；验签、解密及原报价/商户核对后才更新订单，页面跳转不授权益。真实支付、退款、账单和微信真机不因合成协议测试通过而视为通过。

媒体单文件上限8MiB、每机构128MiB，存入PG并随完整备份恢复；整场大录像和外部存储/转码仍需单独交付。仅两条 `.../entries/:id/media-files`、`.../matches/:id/media-files` POST 放宽到12MiB JSON，其他请求100KiB；nginx与API均限制。私有保险/报名资料不可公开。每次公开文件及Range读取都复验原观众授权，撤销后旧路径失效。片段是人工定位，不是已生成剪辑文件；保单文件不等于承保核验。

外部公开媒体链接默认关闭；如确有原本公开的资源，配置 `SCB_MEDIA_TRUSTED_HOSTS` 为最多20个精确小写HTTPS host（逗号分隔，无通配/IP/端口），通过已有运维覆盖传给 API。服务端不抓取外链；已获知的第三方URL不能由本站撤回。要求正文可撤销时使用受控自持文件。
