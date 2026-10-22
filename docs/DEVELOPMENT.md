# 本地开发与验证

更新：2026-10-22（Asia/Shanghai）。适用范围：已整合的P01 Mock、P02真实API、P03-A Web报名及P04-A单循环排赛／一次发布。P04-A为DONE / MAIN，经[PR #4](https://github.com/xyq-dev/small-city-basketball/pull/4)合并为 `9fc9b3019eeef52d5b7a66643b01f0fe993af09f`；后续开工仍核验最新HEAD和dirty。P03-A/P02/P01历史基线与证据见[TESTING](TESTING.md)。

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
| API | P02身份／机构／赛事、P03-A球队／报名／冻结及P04-A共享场地／单循环排赛／一次发布 | 真实PostgreSQL；刷新和重启后仍可读取已提交数据 |

无.env且未设置VITE_DATA_MODE时使用Mock，执行 `npm run dev` 即可。已有.env时先确认模式；设为 `VITE_DATA_MODE=mock` 才是明确的演示环境。API模式不能因连接失败、未授权或读取后页失败而退回Mock。

## 3. 启动真实API模式

复制根 `.env.example` 为 `.env`，替换密码占位值。DATABASE_URL中的密码须与POSTGRES_PASSWORD一致，DEV_SEED_PASSWORD仅用于可选开发seed；不要提交.env。

准备支持btree_gist的PostgreSQL，并为迁移身份提供创建该扩展的必要权限；003使用此扩展实施资源时间排他约束，不可跳过。也可使用仓库Compose配置：

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

`npm run db:migrate`依次应用001→002→003；既有数据库的已应用文件只校验并跳过，不修改历史Migration。三条迁移均已在CI隔离测试库执行及复跑校验，命令在自己的环境是否成功仍以本次输出为准。

在Web登录页可注册机构账号，进入空赛事空间；“球队领队？创建个人账号”只建立User和Session，不创建机构或工作人员。个人页面显示本人ID，机构OWNER/ADMIN用该existingUserId签发球队邀请；领队登录目标账号后接受，并刷新独立teamContexts。邮箱尚未验证，不能用email自动认领邀请；微信登录和密码重置未实现。

可选执行 `npm run db:seed`，必须显式设置DEV_SEED_PASSWORD；只使用合成资料，seed幂等且不清库、不重置已有密码。API启动不自动迁移或seed。

## 4. 主要页面

| 页面 | 路由 | 行为 |
|---|---|---|
| 工作总览 | `/` | 当前模式及机构的赛事入口 |
| 赛事列表 | `/events` | 名称/状态筛选、清空及详情导航 |
| 创建赛事 | `/events/new` | 校验后创建DRAFT；API权限由服务端确认 |
| 赛事详情 | `/events/{id}` | 读取草稿及按权限编辑；版本冲突有反馈 |
| 球队与球员 | `/teams`、`/teams/{teamId}` | 按授权维护长期成员、签发邀请和停用领队；球队模式仅本队详情 |
| 报名审核 | `/registration`、`/events/{eventId}/registration` | 工作人员配置报名规则、开关报名、查看审核及冻结结果 |
| 我的球队 | `/my-team` | 独立领队上下文读取开放赛事及本队既有报名 |
| 报名名单 | `/entries/{entryId}` | 按capabilities编辑、提交、独立审核或只读；每次保存产生新revision |
| 排赛入口／共享场地 | `/scheduling`、`/courts` | 工作人员按授权进入；OWNER/ADMIN管理canonical Court |
| 赛事排赛／历史稿 | `/events/{eventId}/scheduling`、其`/history/{revisionId}` | 配置显式policy、生成／重抽、全量分配、定位冲突、一次发布及读取正式场次；旧稿只读 |

API模式的注册、登录、退出、机构／球队切换和会话恢复在运行外壳中处理。用户主动切换工作空间到对应首页，后台刷新授权保留合法详情路径；切队不会带入上一队资料。邀请链接仅含fragment凭据，首次及hashchange读取后立即清除，不写localStorage/sessionStorage。Mock模式不接P03/P04真实服务，其示例赛事和刷新重置不能混入真实结果。

推荐合成数据验证顺序：机构建DRAFT赛事并保存报名规则→领队接受本队邀请、维护长期成员→机构开放报名→领队建报名并保存／提交名单→独立工作人员审核→关闭报名→至少两队获批且无待审／待修改时冻结。负责人若同时是该队当前领队或最近提交人，也不能自审。冻结后仍为REGISTRATION_CLOSED。P04-A可继续：建立共享Court→为2–32队ROUND_ROBIN填写占用时长／休息／本地日期间隔和带明确偏移的可用窗口→生成当前稿→全量分配→校验与修正→一次发布进入SCHEDULED。重抽需原因、旧稿保留；publish重新检查当前正式占用，发布后不能编辑或改期。记分、保险附件、OBS和视频未接入。

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

真实数据库集成另执行 `npm run test:integration`：必须设置TEST_DATABASE_URL且数据库名以 `scb_test_` 开头，使用专门隔离库，禁止指向真实业务数据；当前脚本限定test/下的68项独立PG场景（20＋24＋24）。API浏览器检查执行 `npm run test:api:e2e`，使用另一个隔离DATABASE_URL；配置先迁移并启动API3300和Web4273，APP_ORIGIN固定为 `http://127.0.0.1:4273`，不能复用其他服务。实际PG重启检查由CI的capture→docker restart→verify步骤执行，普通集成命令本身不等于执行了数据库重启。

构建输出包含admin与api。仅预览admin静态构建可用：

```sh
npm run preview --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 4173 --strictPort
```

静态预览不等于部署，API模式还需要相应同源代理及后端服务。当前158项源码／组件／HTTP、68项PG、12项Mock及8项API浏览器，以及重启结果见[TESTING](TESTING.md)和[P04-A交接](handoffs/P04-A.md)；P03首两轮失败与修复仍保留于[P03-A交接](handoffs/P03-A.md)，不在启动文档重复维护运行日志。

## 6. 当前边界与接续

P01、P02、P03-A、P04-A为DONE / MAIN。迁移001–003已在隔离测试库执行、复跑校验，并通过真实PG重启验证；没有生产数据库或生产部署，不把重启验证当成灾备恢复。生产默认关闭机构及个人自主注册，要求HTTPS及Secure Cookie，但生产环境尚未配置。

P03-A只交付Web报名／独立审核／名单冻结；完整P03的保险文件、本人身份与小程序尚未完成，P04其他赛制／自动排时／改期及P05/P06尚未交付，微信、云服务及真实OBS均未接入。接续先读[当前状态](CURRENT_STATUS.md)、[任务看板](TASKS.md)和分配任务卡，再在独立任务分支实施。
