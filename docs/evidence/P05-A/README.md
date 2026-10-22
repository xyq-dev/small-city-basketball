# P05-A证据索引

更新：2026-10-22（Asia/Shanghai）。当前REVIEW / BRANCH_ONLY。首CI真实PG/重启及旧浏览器通过，新记分表单失败已修复；第二轮完整验收待运行，不能标DONE。

## 源码与本地检查

完整feature已整合Scoring API、UI、19项新增PG场景和真实浏览器/重启脚本；根format、完整strict typecheck（含PG/E2E）、212项源码/组件/HTTP（admin125+api87）、两端build通过。旧158项保留，新增54项（记分UI28+赛程状态兼容8+API18）。尚未本地运行PG：当前仅UID0，不绕过PostgreSQL运行保护。

独立API/SQL/UI静态审查CLEAR，004允许沿001→004进入空隔离库。004 SHA256 `ebf454ab7e5bcb86e9453bab0e9783d792f5c0755fd7621878aa96a3c997ab83`。迁移已在首轮CI隔离测试库执行及重跑校验，未操作生产。

## 合成HTTP布局截图

- [桌面记分工作台1440](live-1440.png)：显式主写控制、球队基础统计和服务器锚点时钟布局。
- [手机待确认390](pending-390.png)：独立赛果确认、规则、人员和操作历史布局。

四组模式live/pending ×1440/390均检查，document scrollWidth等于viewport，按钮无文字截断、输入无卡片越界、pageerror为空；手机表单输入16px，桌面保留一处13px选择器，不声称桌面全16px。截图使用临时Noto Sans SC帮助QA显示，产品依旧系统字体，没有新增字体依赖。

截图由本地Chromium153和**合成HTTP响应**产生，seed/人名/比分均为合成；没有向真实API写分、不能证明PG事务、可靠离线、真实OBS或生产可用。真实业务证据必须随后记录官方浏览器及真实数据库CI。


## 首轮真实CI及修复历史

[CI39742003544](https://github.com/xyq-dev/small-city-basketball/actions/runs/39742003544)，source `c2c0e83460da2f652a656f6cae508e9c9d35a323`（treeba3ca7d450e805b62915f49f7d584c58de657435）：207源码检查、87独立PG、实际PG18.6重启、12Mock及原8API浏览器成功；新增记分桌面/手机2项均在显式规则界面的精确“平局处理”label选择超时。没有把首次失败标为全部通过。

原生Chromium153最小DOM复现nested select label精确匹配0、显式aria-label后1；修复全部8个P05 select和3个理由textarea。修复后在真实浏览器的合成HTTP页面走规则、人员、补录/替换控件的精确选择，1440/390四组全部成功；这不替代真实后端浏览器检查。

GitHub CodeReview对c2c0提出三项有效finding：仅场次用户的赛事级链接会404、先停成员后无法停用场次授权、替换客队统计时默认主队。已逐项修复并独立复核CLEAR，新增5组件及1真实PG回归；大写UUID同样正确终止旧lease。修复后的212项本地检查、strict、format、build通过；88独立PG及10API浏览器待第二CI，review线程待验证后关闭。自动security review未运行。
