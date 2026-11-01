# UI002-MARKET交接

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。

目录scb-ui-market、分支work/ui002-market，基线3316083、clean开工，原registration工作区未切分支。仅负责players/compare WXML/WXSS、新测试、自有文档；validation拥有旧native/E2E/c11/catalog迁移，root拥有资产及汇总。

已实际获取UI001 T06/T08 metadata和五个关键子层高保真context/截图，具体节点与尺寸见任务。root已确认用T06真实22px user图标/行min58，不保留旧大照片卡；T08删除204px照片头，按行自适应表格保留3人和原费用/来源。业务JS计划零diff，真实API、权限和资金规则不动。

下一条操作：写两页结构和样式，执行新直接交互及原生解析验证；将最小实现提交交root串行同步，再由validation核320/390/430及最终CI。暂不宣称200画板或正式微信全部验收。


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
