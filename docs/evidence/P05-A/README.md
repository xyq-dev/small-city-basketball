# P05-A证据索引

更新：2026-10-22（Asia/Shanghai）。当前仅本地及静态审查证据，真实PG/重启/官方API浏览器待PR CI，不能标为通过。

## 源码与本地检查

完整feature已整合Scoring API、UI、19项新增PG场景和真实浏览器/重启脚本；根format、完整strict typecheck（含PG/E2E）、207项源码/组件/HTTP（admin120+api87）、两端build通过。旧158项保留，新增49项（记分UI23+赛程状态兼容8+API18）。尚未本地运行PG：当前仅UID0，不绕过PostgreSQL运行保护。

独立API/SQL/UI静态审查CLEAR，004允许沿001→004进入空隔离库。004 SHA256 `ebf454ab7e5bcb86e9453bab0e9783d792f5c0755fd7621878aa96a3c997ab83`。这不是执行记录或线上验收。

## 合成HTTP布局截图

- [桌面记分工作台1440](live-1440.png)：显式主写控制、球队基础统计和服务器锚点时钟布局。
- [手机待确认390](pending-390.png)：独立赛果确认、规则、人员和操作历史布局。

四组模式live/pending ×1440/390均检查，document scrollWidth等于viewport，按钮无文字截断、输入无卡片越界、pageerror为空；手机表单输入16px，桌面保留一处13px选择器，不声称桌面全16px。截图使用临时Noto Sans SC帮助QA显示，产品依旧系统字体，没有新增字体依赖。

截图由本地Chromium153和**合成HTTP响应**产生，seed/人名/比分均为合成；没有向真实API写分、不能证明PG事务、可靠离线、真实OBS或生产可用。真实业务证据必须随后记录官方浏览器及真实数据库CI。
