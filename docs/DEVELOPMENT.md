# 本地开发与验证

更新：2026-10-22（Asia/Shanghai）。适用范围：已整合的P01 Mock及P02真实API后台。P02通过[PR #2](https://github.com/xyq-dev/small-city-basketball/pull/2)合并，交付基线 `29c4ee4cf588e911b2e087224522b832b726d18e`；后续开工仍须核验最新HEAD和dirty。

## 1. 获取与安装

新目录可执行：

```sh
git clone https://github.com/xyq-dev/small-city-basketball.git
cd small-city-basketball
npm ci
```

已有checkout先核验目录、远端、分支、HEAD、未提交改动，按任务要求更新，不重复克隆或强制覆盖。私有仓库使用已授权GitHub身份，不把凭据写入URL。使用Node24；package.json下限为22.12.0，不代表已逐一验证全部版本。

## 2. 选择数据模式

| 模式 | 用途 | 保存行为 |
|---|---|---|
| Mock | P01演示和界面验证，不需要数据库 | 内存数据，刷新重置；不采集真实人员资料 |
| API | P02注册登录、机构授权、赛事草稿持久化 | 真实PostgreSQL；刷新和重启后仍可读取已提交数据 |

无.env且未设置VITE_DATA_MODE时使用Mock，执行 `npm run dev` 即可。已有.env时先确认模式；设为 `VITE_DATA_MODE=mock` 才是明确的演示环境。API模式不能因连接失败、未授权或读取后页失败而退回Mock。

## 3. 启动真实API模式

复制根 `.env.example` 为 `.env`，替换密码占位值。DATABASE_URL中的密码须与POSTGRES_PASSWORD一致，DEV_SEED_PASSWORD仅用于可选开发seed；不要提交.env。

准备本机PostgreSQL，或使用仓库Compose配置：

```sh
docker compose up -d postgres
```

确认数据库healthy后，在项目根目录执行：

```sh
npm run db:migrate
npm run dev:api
```

另一个终端执行：

```sh
npm run dev:admin
```

.env默认 `VITE_DATA_MODE=api`，API为 `127.0.0.1:3000`，Web为 `127.0.0.1:5173`。APP_ORIGIN必须精确匹配浏览器origin；改API端口时同步API_PROXY_TARGET。数据库凭据仅供服务端使用，不进入前端包。Compose是本地运行选项；已执行的真实数据库验收来自CI隔离PostgreSQL18.6，不把当前容器未执行的Compose命令写成已通过。

在Web登录页注册机构账号，可进入自己的空赛事空间；P02未实现邮箱验证、微信登录或密码重置。可选执行 `npm run db:seed`，必须显式设置DEV_SEED_PASSWORD；只使用合成资料，seed幂等且不清库、不重置已有密码。API启动不自动迁移或seed。

## 4. 主要页面

| 页面 | 路由 | 行为 |
|---|---|---|
| 工作总览 | `/` | 当前模式及机构的赛事入口 |
| 赛事列表 | `/events` | 名称/状态筛选、清空及详情导航 |
| 创建赛事 | `/events/new` | 校验后创建DRAFT；API权限由服务端确认 |
| 赛事详情 | `/events/{id}` | 读取草稿及按权限编辑；版本冲突有反馈 |

API模式的注册、登录、退出、机构切换和会话恢复在运行外壳中处理。Mock模式的示例赛事和刷新重置不能混入真实机构结果。报名、排赛、记分、保险文件、OBS和视频入口仍属规划，不因存在菜单而视为服务已接通。

## 5. 验证命令

```sh
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test`覆盖不依赖数据库的单测、组件和HTTP行为。`npm run test:e2e`使用显式Mock模式，固定4173端口且不复用其他服务器；桌面与手机项目均为Chromium，手机是设备模拟，不等于Safari、微信或真机。

真实数据库集成另执行 `npm run test:integration`：必须设置TEST_DATABASE_URL且数据库名以 `scb_test_` 开头，使用专门隔离库，禁止指向真实业务数据。API浏览器检查执行 `npm run test:api:e2e`，使用另一个隔离DATABASE_URL；配置先迁移并启动API3300和Web4273，APP_ORIGIN固定为 `http://127.0.0.1:4273`，不能复用其他服务。

构建输出包含admin与api。仅预览admin静态构建可用：

```sh
npm run preview --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 4173 --strictPort
```

静态预览不等于部署，API模式还需要相应同源代理及后端服务。实际检查数量、CI版本和持久化证据统一见[TESTING](TESTING.md)及[P02交接](handoffs/P02.md)，不在启动文档重复维护运行日志。

## 6. 当前边界与接续

P01、P02为DONE / MAIN。迁移001已在隔离测试库执行，没有生产数据库或生产部署；不把数据库重启验证当成灾备恢复。生产默认关闭自主注册，要求HTTPS及Secure Cookie，但生产环境尚未配置。

下一项P03-A Web报名闭环为TODO／待开工。先读[当前状态](CURRENT_STATUS.md)、[任务看板](TASKS.md)和分配任务卡，再在独立任务分支实施；保险文件、微信、云服务及真实OBS均未接入。
