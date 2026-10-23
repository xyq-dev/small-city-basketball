# C02 本地真实数据库与浏览器运行条件

2026-10-23（Asia/Shanghai）；负责人：validation_runtime；只读运行条件检查及临时下载探针，无仓库业务文件修改。

## 结论

本地 Node HTTP loopback 可运行；当前环境未具备原生 PostgreSQL 或 Chromium 执行条件。没有运行真实 PostgreSQL 集成、数据库重启、浏览器或生产容器测试；不能把这些检查算作通过。没有访问正式服务、生产数据库或其他项目。

## 实测

| 检查 | 结果 |
| --- | --- |
| `node` / `npm` / `playwright`包 | 可用，来自现有runtime及仓库依赖 |
| Node绑定`127.0.0.1`并自身HTTP请求 | 200，响应`C02_LOOPBACK_OK`；临时端口44611，程序退出后已关闭 |
| `docker` / `postgres` / `initdb` / `pg_ctl` / `psql` | PATH中不存在；`/usr/lib/postgresql`不存在 |
| 原生PG的非root执行条件 | 当前UID/GID均0；`runuser -u nobody -- id`失败：`cannot set groups: Operation not permitted`；子进程`os.setuid(65534)`失败：errno22 `Invalid argument`。未绕过PG root保护或修改系统账号 |
| PGDG包索引 | 官方HTTPS可读取，索引列出noble的PostgreSQL18.6；仅保存约1.2MB包索引及元数据，没有安装/执行服务端或修改apt配置 |
| Chromium本地缓存 | 不存在；Playwright期望`chromium_headless_shell-1234`，Chrome151.0.7922.34 |
| `chromium.launch()` | 失败：`Executable doesn't exist` |
| `npx playwright install chromium --only-shell` | 下载失败，Playwright自动重试后退出1：`End of central directory record signature not found` |
| 官方下载URL诊断 | CDN返回HTTP200，但实际是195字节`text/html`，正文为`Site Unavailable / Unable to access this site`，不是ZIP。没有下载/运行替代来源的浏览器，没有关闭TLS校验 |

## 已保留临时内容

`/workspace/scratch/dc6a786e1a31/commercial-checkpoints/runtime/`仅包含PGDG包索引与非秘密包元数据；没有数据库、数据库凭据、运行中服务器或容器。Playwright下载没有成功安装浏览器。

## 既有隔离CI路径

仓库`.github/workflows/ci.yml`已经包含，无需新workflow或生产环境：

- `admin`：格式、完整类型、源码测试、构建、官方Chromium及Mock浏览器。
- `api`：PostgreSQL18.6独立服务，集成测试、捕获→实际重启→校验、真实API桌面/手机浏览器及成功/失败owned清理。
- `production`：独立三镜像、可信本地HTTPS、runtime权限、真实重启、完整dump/restore与隔离。

本代理没有push、创建PR、触发或重跑CI。需要root在核实当前Git授权并完成本地源码检查/审查后，通过既有PR流程获取新的CI证据；不得沿用旧SHA CI结果声称本次修改通过。

## 给集成人的更新提醒

- 新008/009由其负责代理编写；首批计划只ALTER现有表，若实际保持40表，readiness/manifest的40表门槛应保留。
- `scripts/check-production.mjs`第486行现硬编码SQL迁移文件数7；若008/009均整合须更新为9，不能删除检查。
- runtime manifest和恢复/指纹检查必须覆盖新列、原子更正/确认及用户名维护后的会话撤销；别只改迁移数。
- 依赖安装成功或HTTP探针200不等于浏览器可用；Node内存Mock/PGlite不等于真实PostgreSQL。
