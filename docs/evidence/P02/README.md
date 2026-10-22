# P02 验证证据

更新：2026-10-22（Asia/Shanghai）。状态IN_PROGRESS；尚未完成真实数据库验收，不能视为已上线。Git/测试最终结果见[P02交接](../../handoffs/P02.md)。

## 当前本地证据

根集成后重新执行npm ci、格式检查、严格类型、71项测试（前端51+API20）及两端构建，全部通过；API20项含真实Nest HTTP边界，但不连接数据库。独立安全测试已编写20项真实HTTP+PG场景；根另编写桌面/手机4项真实API浏览器场景，它们目前尚未执行。

原生PG18.4二进制可读版本，但容器UID映射限制阻止安全启动，真实数据库验证将在GitHub CI PostgreSQL18.6隔离服务执行；没有用内存数据库替代。Migration已编写并静态审查，尚未执行。

## 界面检查

登录/注册页面在1440与390宽度检查无横向溢出或运行错误，输入字号16px。下图为隔离未登录状态截图，测试页将session读取拦截为401，仅用于视觉检查，不证明数据库或登录成功。容器缺字，QA页临时注入本地Noto Sans SC；产品仍用系统字体，未引入外部字体请求。

![P02桌面登录页](login-1440.png)

![P02手机注册页](register-390.png)

## 首轮CI结果

[PR#2](https://github.com/xyq-dev/small-city-basketball/pull/2)，[run39730422963](https://github.com/xyq-dev/small-city-basketball/actions/runs/39730422963)：71项检查与原12项Mock浏览器通过；20项真实PG集成及PG18.6重启持久化通过，Migration已在隔离测试库执行。API浏览器因嵌套npm脚本参数传递失败，4项未执行；已修正启动命令，等待重跑结果。没有生产Migration或生产数据操作。
