# P07-A 打包交接

2026-10-22 UTC，负责人 `/root/product_docs`。**REVIEW / LOCAL_ONLY**，仅打包分工，不代表P07-A或生产交付完成。

## 实际上下文与范围

- 独立目录 `/workspace/scratch/93747c9ad2cb/p07-package`，分支 `feat/P07-package`；远端 `xyq-dev/small-city-basketball`。
- 起点main `f2bf36585f09a0e55df41328a1d25f33e479e012`／tree `80a9b297e780840914ab5f27c6c8cccd9fa3a45d`，开工仅root提供的未跟踪node_modules软链接，不提交。
- 独占Dockerfile、.dockerignore、compose.production.yaml、ops/web、ops/templates及本交接；不修改API、PG、CI和汇总。root特许同步单文件权限manifest `d942b63`，本分支cherry-pick为 `6d26cb4`；root集成打包时跳过这一重复共享提交。
- 按[正式任务](../tasks/P07-A.md)构建api/web/db-tools；API/DB工具workdir `/app`，Web docroot `/usr/share/nginx/html`，生成配置及temp均在 `/tmp/scb-nginx`。

## 当前检查点

Dockerfile、生产Compose、受限Web entrypoint／nginx模板、私有文件安装／更新／隔离备份恢复说明已写完。API/DB工具工作目录/app；Web docroot只读；archive挂/backups，默认application.dump／restore-receipt.json且host环境可覆盖。API/Web networks分别frontend＋backend／frontend；源PG与作业backend，目标restore／quarantine独立recovery。SCB_RESTORE_SECRET_DIR仅目标，不回落源secret。build target保留源码、测试和开发依赖供独立CI检查，三生产target只选择最小产物。PG脚本由独立负责人提供；镜像COPY真实ops入口，不创建占位脚本。API/PG共享新源须root整合后统一构建。

本地已执行：`sh -n`；真实authority校验片段4个合法／17个非法输入，包含nginx注入、userinfo、path/query/fragment与端口边界，均通过且固定错误不回显输入；PyYAML解析及service/secret/端口/网络/只读/volume断言；两个新Markdown本地链接；支持格式的YAML/JSON/Markdown Prettier检查；`git diff --check`。临时目录offline npm ci按Docker相同workspace／omit参数安装111包，pg/Nest/contracts可用，tsx/Vite/TypeScript/Vitest/React/Playwright均未安装，无workspace嵌套node_modules，contracts链接指向../../packages/contracts。未重复运行应用测试。

本地无Docker／nginx，不声称镜像、实际secret UID、TLS或恢复已执行。实际Node-musl/PG客户端、三生产镜像非root、Web配置、runtime全链、独立目标完整restore及失败清理由root CI验证。build所需API新源／ops尚待root集成，不能用当前单独打包分支替代完整候选。

尚无本卡业务Migration，本分工未执行数据库迁移或生产部署。未push。下一步root先整合API／PG实际源，再挑选本分支打包提交（跳过已整合的manifest），执行四target构建及完整生产CI；未通过前不能将P07-A标DONE。

## Web服务重建补强（2026-10-22 UTC）

root已整合首打包提交018dfdc，本次仅修改ops/web/nginx.conf.template及本交接。原直连proxy_pass在启动时解析api，API force-recreate换IP可能使仍运行的Web持有旧地址。改为共享zone的scb_api upstream，Docker内置DNS127.0.0.11、valid=5s、resolver_timeout=2s、server api:3300 resolve。四个代理location均用无URI后缀的http://scb_api，维持原path/query与API404；authority唯一envsubst、XFF/Host/Proto覆盖及SPA边界均保留。

核验依据为官方[nginx upstream resolve/zone/resolver](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server)（开源从1.27.3支持）、[proxy_pass无URI语义](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)、[Docker内置DNS](https://docs.docker.com/engine/network/#dns-services)和[Compose容器更新](https://docs.docker.com/compose/how-tos/networking/#updating-containers-on-the-network)。本地执行sh语法、模板括号／四location／唯一替换变量／不改path和headers断言、Markdown格式及diff检查；无nginx二进制，未声称nginx -t或实际DNS通过。root CI须保持Web容器不重启，实际force-recreate API并在45秒窗口验证readiness和原会话恢复，且证明新容器／地址变化及Web身份未变。

另只读核对db-tools仍为postgres18.6-alpine3.24＋同架构node24.22.1-alpine3.24，并显式apk add libstdc++；未在本地实际pull或验证libgcc/transitive依赖。Node/PG客户端启动及真实动态链接以CI结果为准，本次不改Dockerfile。
