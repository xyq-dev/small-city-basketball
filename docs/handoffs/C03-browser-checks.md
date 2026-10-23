# C03 浏览器与重启/完整恢复验收实现

2026-10-23（Asia/Shanghai）；实施者 `/root/c03_browser_checks`，集成人root。工作树`/workspace/scratch/dc6a786e1a31/c03-browser-checks`，分支`feat/C03-browser-checks`，基线909fb74，origin原仓库。开工只有root提供contracts依赖镜像dirty；本作者不提交该镜像。IN_PROGRESS / LOCAL_ONLY，无commit/push/生产操作。

范围：扩展原真实API scoring.spec两种采集模式既有单场FINAL夹具，验证球员榜、整届完赛、显式历史授权、归档/重开、旧键永久失效与闭赛写拒绝，不新增浏览器注册账户。restart checker保留原运行时钟/两次改期/旧观众与OBS夹具，新增独立C03赛事复用已有leader/writer身份，保存ARCHIVED + 显式HISTORY、个人基础汇总与sourceHash及独立OBS授权，进入原40表实际PG重启/完整dump恢复链。

环境：本地无可用PG/Docker/官方Chromium；本作者只运行语法/类型/格式，真实浏览器/PG执行等待集成后的隔离CI，不把编写断言当作通过。
