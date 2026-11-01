# UI002-MARKET：按UI001落实找球员与同价比较

状态：IN_PROGRESS；integration：LOCAL_ONLY。

- 负责人：Codex `/root/ui_registration`；root唯一集成。
- 日期：2026-11-01 Asia/Shanghai。
- 独立目录：`/workspace/scratch/5a4363d2d0b7/scb-ui-market`，分支`work/ui002-market`。
- 开工HEAD：`3316083e47cab2adf8a16cca05534e87a83981f0`，初始clean，远端xyq-dev/small-city-basketball。
- 独占：players/compare的WXML/WXSS、新直接测试及本任务/交接；业务JS保持零diff。共享旧native/E2E/catalog测试与图集由validation单写，资产由root提供。
- 旧CI170源码为历史候选，不据旧C11几何测试继续保留历史照片大卡。当前UI001优先，根任务checkpoint12另行收口。
- 禁止：角色、API、资金、路由、Migration、pack、部署及生产变更。

## 实际设计来源

已直接读取T06 `5:1047`及T08 `5:1147`的metadata，取得以下高保真context与返回截图：T06 Filters `5:1060`、Form `5:1067`、服务档案 `5:1074`；T08比较表 `5:1160`、固定操作 `5:1187`。不以聊天摘要重绘。

T06：16px边距；三个64×44、gap8标签；两个74px字段卡、gap12、p12/r12；档案卡p16/r16，标题18/28，每行min58、user22、name14/22、meta12/18、chevron16。root确认实际T06为22图标，不采用摘要中的64头像（64属于T07）。真实字段可增高，禁止固定行高截断。

T08：p16/r16卡片，18/28标题；34px最小表头，38px最小数据行、gap8，位置/交通/含费预计/统计样本；不保留204px照片表头。3人横向滚动且标签保持可见，长姓名按整行增长，原费用分项、未统计与来源信息仍可展开。固定footer为同排48px双CTA，gap12：继续选人/预约真实当前对象。

## 实施与验证边界

重用原筛选、选择、目录/授权统计读取、最多3人、当前账号令牌和booking导航handlers；不新增业务请求或伪造照片、统计及资金结果。默认user资产由root提供，私有照片不进入列表。

计划验证：新直接VM验证选择/同价/当前目标/隐藏及账号切换门槛和费用信息可达；基本原生解析、三宽合成模板；浏览器几何/实际PNG由validation和最终精确候选CI核验。官方微信/真机和外部通道另验。


## 本地实现检查点

两页WXML/WXSS已按实际设计子层重组，业务JS零diff。T06依次为三标签、两字段入口、白底紧凑服务档案；普通资料行58px，用户图标22px、姓名14/22、元信息12/18、chevron16px。为保持原选择业务，行尾增加独立44px选人键；最多3人及至少2人进入对比的原handler不变。两字段入口打开原筛选编辑，姓名、城市、位置、费用、日期、排序及同价锚点的原应用/清除行为保留。长名和金额可使行增长，金额不可拆字。

T08改为18/28标题与34px最小表头、4个38px最小数据行；没有照片表头。费用、有限统计、授权来源和逐人查看/预约/移除仍可通过原信息开关访问。2人表格最小326px，320宽横滑以保留金额和标签；3人表格475px，保留第三人和sticky项目列。footer同排继续选人/预约当前firstId，长名保留完整aria-label及表头，按钮文案单行省略。

相对画稿的业务差异：未筛选成同价时CTA和标题使用中性比较文案，不宣称混价档案同价；原未统计/暂不可用保留；单项服务费与含费预计不混用；默认user图标来自root实际Figma资产。root提供资产，共享旧UI测试由validation迁移。

已执行：native-structure + player-market 103/103通过；native-control-bindings 1/1通过；新ui002-market-flow direct测试5/6通过，唯一阻塞为chevron-right.svg资产尚待root加入导致T06合成渲染ENOENT，五个已过用例包括真实Page的筛选、最大三人、当前令牌、三人费用表、当前预约目标/移除重读和统计不可用。新测试格式检查和git diff --check通过。尚未执行本地浏览器、官方微信/真机；320/390/430几何/PNG与最终精确CI由root/validation核验。当前不标DONE。


## 本地验证完成（待整合验收）

root已提供实际chevron资源，按其原字节复制至本工作树仅供验证，资产文件不纳入本实现提交。新direct测试重跑6/6通过，覆盖实际Page handlers和三宽原生合成渲染；加上原103项结构/业务及1项绑定检查，共110项通过，无失败。此前资产ENOENT已解除。格式与diff检查通过，两页业务JS零diff；未本地浏览器、未官方微信/真机，状态为IMPLEMENTED / LOCAL_VALIDATED，最终几何/截图和精确候选CI待root/validation。无push、部署或生产修改。


## 独立设计逐值复核增量

validation亲取5:1067/5:1075/5:1161高保真，确认字段label18+gap8+body22、两标题Bold700。仅将market-field-value原margin-top4改8、profiles-title/comparison-intro600改700，不改JS/字段/金额或交互。新6项direct再次通过，diff通过；浏览器几何由validation按真实74字段/58行/34表头/38数据验证。


## 功能图标守卫增量

validation完整原生回归指出额外选择键的Unicode勾/加字符违反现有icons守卫。已将这两种状态改用项目原scb-icon check/plus，保留44px触控、28px选择框、原toggle及source22头像/16chevron。新direct6项与原icons5项通过，不降低共享守卫。


## 比较卡逐值复核

validation实际5:1160完整高保真核330px正常卡：p32+标题28+表头34+四数据行152+六gap48+脚注36。移除comparison-footnote额外margin-top4，最后一行已有8px间距，防正常卡多4。保持长内容可增高、326最小表宽与金额不拆字。新direct6项通过，未本地浏览器。
