# 微信预览包超限与分包

## 上下文

- 更新时刻（含时区）：2026-11-02 08:33 Asia/Shanghai
- 负责人 / 会话标识 / 接收人：当前修复分支负责人；交给 Codex 复审 Draft PR
- 实际绝对目录、仓库远端：`D:\Projects\small-city-basketball`，`https://github.com/xyq-dev/small-city-basketball.git`
- 实际分支 / 基线 HEAD / 当前 HEAD：`fix/wechat-preview-size`，基线 `717a3a7a9fbb91aa93370d6dc594c10b58bdf4c9`；提交 SHA 以本次推送后的 PR head 为准
- dirty 与已有他人修改：开工时仅有本轮小程序打包改动。`project.private.config.json` 由 `.git/info/exclude` 本地排除，未跟踪、未提交。stash@{0} 保留
- 任务状态 / 整合状态（LOCAL_ONLY、BRANCH_ONLY、MAIN）：BRANCH_ONLY，Draft，未合并
- commit / push / pack / 部署 / Migration / 生产数据权限分别为：本轮允许 commit、普通 push 和 Draft PR；不允许生产打包、部署、Migration、生产数据、体验版上传、提审或发布

## 本次完成

- 目标与实际变更文件：微信预览源码包从单包 2636KB 降到可上传。`project.config.json` 排除 `test/`、`.md` 和五张无运行时引用的照片；`app.json` 把五个导航页和 `pages/trade-order/index` 留在主包，其余 67 页按原路径分包。回归覆盖全部 73 条路径、跨包 require 和隔离验收脚本。
- 需求/API/数据/决策同步位置：未改 API、权限或数据库。同城页继续引用 `pages/trade-order/client.js`，因此该页留在主包。
- 分支成果是否已进入 main：否。

## 验证证据

| 检查 | 实际命令或操作 | 环境及提交/工作区 | 结果 | 证据位置 |
|---|---|---|---|---|
| 结构、导航、打包和隔离验收 | `node --test` 五个指定测试文件 | Node 24.22.2，提交前工作区 | 106 通过，0 失败 | 本交接 |
| 格式 | Prettier `--check` 于改动的 json、cjs、mjs | 同上 | 通过 | 本交接 |
| 空白 | `git diff --check` | 同上 | 仅 CRLF 提示，无空白错误 | 本交接 |
| 微信编译与预览 | 清理当前工程编译缓存后 `cli preview` | 开发者工具，AppID 来自未提交的本地配置 | 预览成功。主包 864.5KB（885211 字节），全部包 2.1MB（2245509 字节） | 工具输出。修改前源码包 2636KB 被拒绝 |
| 页面打开 | 开发者工具按导航目标路径 `redirectTo` | 重新编译后的模拟器 | 五个目标页均加载，同城不再空白 | 模拟器截图。不是五个按钮都点中，也不是真机 |

测试计划、实际执行、CI 与线上结果分别记录。没有对应工具或网络访问时直接写明限制。

## 遗留与恢复

- 未完成项 / 阻断原因 / 解除条件：预览二维码已生成，真机未扫码。鼠标点中过「赛事」；「同城」第一次点中后因主包引用分包而空白，修复后改为按路径打开。球队、我的和返回首页由路径打开验证，后来的鼠标点击没有命中按钮。`https://basketball.playhubs.cn` 不在当前 AppID 的 request 合法域名列表；本机访问公开赛事路径返回 404。没有部署匹配版本的测试 API，也没有关闭域名校验。
- 已保存文件 / 未提交工作 / 可恢复点：提交只含本交接列出的打包、测试和文档。私有配置留在本机。
- 下一位 AI 的第一条具体操作：阅读 Draft PR 与本交接，复审分包依赖；不要把主包 864.5KB 当成全部包大小，也不要把路径打开写成按钮点击或真机通过。
- 接手前必须重新核验的事实：分支、HEAD、PR head 和该提交自己的 CI。
- Migration：不涉及。
- 真实付费服务或生产影响：无。

## Git 与同步结果

- 新提交、目标分支、推送或 API 更新结果：推送 `fix/wechat-preview-size` 后把 SHA 写入 PR。
- PR / 审查 / main 整合依据：Draft PR 目标 `main`，不合并。
- 若未同步，写明原因及成果位置：`docs/CURRENT_STATUS.md` 与 `docs/TASKS.md` 仍描述已合并事实，本未合并分支不改这两份汇总。
