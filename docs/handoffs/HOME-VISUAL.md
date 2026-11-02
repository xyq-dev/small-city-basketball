# 首页视觉还原

## 上下文

- 更新时刻（含时区）：2026-11-02 09:20 Asia/Shanghai
- 负责人 / 会话标识 / 接收人：当前首页分支负责人
- 实际绝对目录、仓库远端：`D:\Projects\small-city-basketball`，`https://github.com/xyq-dev/small-city-basketball.git`
- 实际分支 / 基线 HEAD / 当前 HEAD：`fix/wechat-homepage`，从 `fix/wechat-preview-size` 的 `148be7343495ee15c7f28ea25290030f150d0b48` 分出。首页提交 `2fec46a4838aeda55c8a1d5a126a5e392d68eae7`
- dirty 与已有他人修改：包体分支 `fix/wechat-preview-size` 和 Draft PR #38 未混入。高清母版目录 `scb-homepage-assets-v1/` 仍未跟踪。`apps/wechat/project.private.config.json` 继续由 `.git/info/exclude` 排除
- 任务状态 / 整合状态（LOCAL_ONLY、BRANCH_ONLY、MAIN）：实现完成后为 BRANCH_ONLY。未合并，`docs/CURRENT_STATUS.md` 未改写成 main 事实
- commit / push / pack / 部署 / Migration / 生产数据权限分别为：沿用既有开发提交、普通 push 和 Draft PR 授权。本轮没有预览上传、发布、部署、Migration 或生产数据操作

## 本次完成

- 目标与实际变更文件：微信首页按素材包参考图重排。运行图在 `apps/wechat/assets/home/`，页面在 `pages/home`，底部五个导航改用素材包 SVG。同城页只增加已有 `kind` 查询，使找球场、约裁判沿用现有筛选。
- 需求/API/数据/决策同步位置：公开赛事仍走现有目录接口。目录没有封面字段，卡片左侧使用素材包球场图并标明“示意图”。没有把参考图里的合成赛事项写入正式列表。
- 分支成果是否已进入 main：否。

## 验证证据

| 检查 | 实际命令或操作 | 环境及提交/工作区 | 结果 | 证据位置 |
|---|---|---|---|---|
| 首页、导航、公开赛事、同城和打包规则 | `node --test` 八个直接相关测试文件 | Node 24.22.2，格式化后的工作区 | 84 通过，0 失败 | 本交接 |
| 格式 | Prettier `--write` 后再次 `--check` 由测试前的写入保证；写入后的测试通过 | 同上 | 被改动的 js、cjs、json 已按 Prettier 写回 | 本交接 |
| 三宽布局 | 原生 WXML/WXSS 兼容预览 320、390、430 | 本地静态预览，不是微信开发者工具，也不是真机 | 主视觉按钮可见，长名称换行或截断，四入口和两张服务卡未溢出 | 本地预览截图 |
| 空列表 | 同一预览注入空的公开赛事 | 合成预览数据，不写入接口 | 显示“全国暂无进行中赛事”“查看全部赛事”“切换城市” | 本地预览截图 |
| 运行包新增体积 | 统计 `apps/wechat/assets/home` | 工作区文件字节 | 293601 字节。图标和场馆插画保持 RGBA。未重新执行开发者工具上传测量 | 本交接 |

测试计划、实际执行、CI 与线上结果分别记录。微信真机、完整回归和远端 CI 本轮未执行。上次主包 885211 字节是包体提交的工具测量，不含本轮图片，不能把 293601 直接写成新的工具结果。

## 遗留与恢复

- 未完成项 / 阻断原因 / 解除条件：没有声称与参考图逐像素一致。主视觉为容纳 44px 按钮略高于参考比例；公开赛事没有封面字段，所以左侧是标明“示意图”的素材图；日期城市用接口原文。参考图底部以上的“我的赛事”“按位置找球员”仍保留，避免去掉登录、预约和位置筛选。其他页面的顶栏未改，底栏图标改为同一套 SVG。
- 已保存文件 / 未提交工作 / 可恢复点：高清母版、参考图和说明留在未跟踪的 `scb-homepage-assets-v1/`，没有打进小程序目录。
- 下一位 AI 的第一条具体操作：先核验本分支 HEAD 与 PR，不要把首页提交加进 PR #38。
- 接手前必须重新核验的事实：开发者工具工程仍是 `D:\Projects\small-city-basketball\apps\wechat`，`miniprogramRoot` 为 `./`。
- Migration：不涉及。
- 真实付费服务或生产影响：无。

## Git 与同步结果

- 新提交、目标分支、推送或 API 更新结果：`2fec46a4838aeda55c8a1d5a126a5e392d68eae7` 已推送到 `origin/fix/wechat-homepage`。包体分支远端仍是 `148be73`。
- PR / 审查 / main 整合依据：[Draft PR #39](https://github.com/xyq-dev/small-city-basketball/pull/39)，目标 `main`。未合并。
- 若未同步，写明原因及成果位置：高清母版目录仍只在本地，未提交。
