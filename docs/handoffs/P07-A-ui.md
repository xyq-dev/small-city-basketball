# P07-A UI 交接

2026-10-22（Asia/Shanghai），负责人 `/root/p01_ui`，REVIEW / BRANCH_ONLY。

开工目录 `/workspace/scratch/93747c9ad2cb/p07-admin`，远端 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/P07-auth-ui`，HEAD `f2bf36585f09a0e55df41328a1d25f33e479e012`。开工除未跟踪 node_modules 复用软链接之外 clean，软链接不提交。已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION及P07-A完整卡。

允许写入 admin AuthCapabilities adapter、AuthForm/Runtime必要变更及回归和本交接；不改共享合同、配置或业务状态机。仅本地提交，不push。精确DTO由root授权同步源提交`5df73bbf364dcc24611846aa23194cff90c386fd`，本分支上游cherry-pick为`39318c3`；字段为canRegisterOrganization／canRegisterParticipant两bool。该上游还包含API runtime-config，本UI提交不重复提交或修改这些共享文件。

实现采用未登录AuthForm独立读取能力：加载／失败均不开放注册，登录独立可用；成功按两个字段分别显示注册，提交再次守卫；重读失败或能力关闭回到登录。已登录工作台不新增能力请求，Runtime最外层watch／overlay保持零私人认证初始化。

开工计划覆盖双开关四组合、无效响应、加载失败／重读、登录不阻塞、StrictMode晚响应及匿名源隔离，然后完整admin、strict、build及格式。root负责真实TLS／容器／PG／浏览器。无migration编写或执行，无生产／原生OBS验收。

## 实施与实际验证

已完成独立 `api/auth.ts`，严格校验恰好两项boolean，8秒超时及取消；AuthForm在未登录时独立加载、失败明确且可重读，初始／失败不猜注册开放。机构／个人开关分别控制入口，提交再次检查对应能力；普通登录不等待该请求。已登录不发能力请求，退出后重新读取；StrictMode旧响应与卸载晚响应不回写。邀请码提示按个人注册状态解释，保留原fragment/hashchange流程；说明未配置邮件投递／邮箱验证。Runtime最外层watch／overlay分流未改变，原独立入口零私人请求的回归保持。

旧Runtime注册夹具现显式返回开放能力；首轮四组合用例等待登录表单挂载不足，修正测试等待后通过，未用开放默认绕过能力请求。新增adapter18项、注册页面11项，共29项；覆盖4组合、缺失／额外／错误字段、超时／取消、能力读取挂起仍登录、失败后重读、无效成功不开放、邀请关闭提示、StrictMode旧响应、退出后重新读取及既有会话不请求。

已执行定向初轮45项通过；完整admin24文件199项通过，随后新增退出后重新读取回归，页面11项通过。strict typecheck、Vite build及所有改动Prettier／diff检查通过；最终完整admin再次执行为24文件200项全部通过（旧171＋新29）；末次strict及格式／diff检查也通过。不修改根配置、合同、Migration或业务状态机，不执行PG／Docker／TLS／生产部署，无push。root负责真实容器及TLS／恢复验收；未把源码检查称为已生产上线。

下一位先cherry-pick本UI源提交（不要重复上游39318c3），对真实GET能力接线及生产org=false/participant=true运行浏览器验证；已有开发API默认双true保持旧流程。合成认证mock需显式处理GET `/v1/auth/capabilities`，返回标准data/meta envelope。当前未合并，不标记MAIN或整个P07-A完成。

## 2026-10-23 接续：PR2 草稿版本冲突恢复

负责人 `/root/review_overlay` 经root显式指派，仅接手 `App.tsx` 的赛事编辑恢复、相关页面回归及本交接。实际目录 `/workspace/scratch/93747c9ad2cb/p07-admin`，远端仍为 `https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/P07-auth-ui`，本次基线 `e46472396de1c448332d34a79454f23ada116d9d`；开工只有原 `node_modules` 软链接未跟踪，保持不提交。既有UI源已由root整合，不重复提交其原改动；本次仅本地commit，不push。

补查确认PR2的 `VERSION_CONFLICT` 原问题仍存在：保存失败后详情继续使用旧Event/version，取消再编辑亦复用旧值。最小修复为冲突后保留输入，明确提示尚未保存并禁用再次提交；编辑字段不会解除冲突。提供“放弃本次修改并读取最新赛事”，用户可先复制所需内容后显式刷新，再核对新版并重新编辑；冲突后的取消／返回同样重新读取。读取失败使用既有详情错误页及重试入口，不允许重新打开旧版。普通保存失败仍可保留输入后重试；没有自动重放旧写入、自动合并或变更API合同。

新增两条组件回归以真实内存仓库并发更新触发CAS冲突：原实现上先失败，修复后验证输入保持／禁止重复旧写、显式读取后使用version2保存，以及取消后读取失败不得回退旧稿、重试成功后才可继续。该证据属于组件／内存仓库测试，不是实际HTTP或PG实测。

实际执行：定向赛事页、Runtime、注册能力4文件56项通过；完整admin24文件202项通过；admin typecheck和Vite build通过。未执行本次真实浏览器／PG／TLS／OBS；由root在整合分支进行已有必要验证。无Migration编写或执行，无生产操作。root下一步只cherry-pick本节对应新commit，保留既有P07 UI源与独立watch／overlay入口，按最终候选执行验证与审查；当前仍为BRANCH_ONLY，不能标记整个P07-A完成。
