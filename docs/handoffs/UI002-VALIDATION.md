# UI002-VALIDATION接续

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。工作区、所有权与限制见[任务卡](../tasks/UI002-VALIDATION.md)。

基线283c4f2；已核验无未提交改动。node_modules仅引用root已安装依赖，不提交该链接。旧首页/导航/账号管理fixture与新设计不一致，正在按实际设计和当前UI状态迁移断言。下一步修正合法预期并反馈真实源问题；不放宽通用布局和权限守卫。

首片 2026-11-01T14:41:53+08:00：测试迁移与14份根域fixture已完成。4新增直接用例及75旧根域回归、42组三宽HTML展开通过；tsc通过；完整原生测试仍有15项已定位失败（1源箭头、14旧SDK工具来源/selector），已交root对应修复，不能标DONE。浏览器三宽/PNG及微信真机未执行。当前依赖fc82be1/314f017分别是root44911ea/e70fbb8的本地副本，root只取本片最终commit，不重复取依赖。

2026-11-01T07:29:34Z：CI167 read-only复核取run41283836322/admin124781055260原始日志与artifact13074294448，原图/metrics在scratch ui002-ci167-evidence。失败候选1319pass/9fail不能作为最终验收；布局原图复核暴露4页双header，已交services修配置。root随后直接核Figma T09/T17并授权仅迁移预约两组精确16px几何、卡r16、按钮16px/r12/至少48/navy；其他旧几何守卫保留。全矩阵增加scb-header与原生导航不得共存，布局JSON输出各计数。

续片分支work/ui002-validation-followup基线86e503b；两份normal home fixture改用实际工具生成NATIONWIDE snapshot及合成已加载赛事，不再用data={}冒充normal。未改源实现、权限、harness或CSP；root负责合入对应源样式、四页custom配置、placeholder修复及后继完整CI。未执行微信/真机或正式外部服务。

续片本地验证：`node --test` ui002-root/c11-shared-ui/c10-core-state-consistency合计11/11通过；两份正常首页在320/390/430的6次模板展开均出现active全国、切换城市及合成赛事，所有资源非空。`npx tsc --project tsconfig.tests.json --noEmit`、三份变更测试/fixture的Prettier及git diff --check通过；Playwright `--list`成功注册2628用例（含按配置跳过的mobile原生项目），仅为注册检查，不冒称运行。当前源基线仍未含services后继样式/JSON修复，因此浏览器执行必须交整合后的精确CI。

2026-11-01T07:30:34Z 独立review纠正续片遗漏：通用非home action12px在booking两组16px前执行，形成互斥。仅让这两个设计迁移group跳过旧12px，其他三组及通用height≥48不变，未弱化溢出/触控/字体/照片守卫。后继小提交基于738431b，需与上片一起集成；后继完整CI才是浏览器验收证据。

2026-11-01T07:46:05Z：CI168原始证据已全保存在scratch ui002-ci168-evidence（admin-job.log、manifest、all-cases/all-screens与2279PNG）；其1328浏览器成功、1314布局/73路由/0自动issues不代表视觉无缺陷。人工确见同城320/390长城市将标题/副标题压成单字竖排，已交root最小flex换行修复。本测试续片只记录localHeading copyWidth/titleWidth/titleLines，要求≥180/≥180/1至2行，断言前先写出布局JSON。禁止以旧候选的全绿替代修复后的精确CI169及同城原图复核。

同城测试片本地：以root9d4e55a源模板展开全部365份fixture×3宽=1095次，资源非空且全部展开成功；tsc、Prettier、diff检查通过，Playwright2628项注册成功。该检查不计算真实浏览器几何，新标题尺寸/行数须由后继CI验证。

2026-11-01T07:52:04Z 追加球员原子金额守卫：总价全内容与服务价直接金额文字节点分别用DOM Range测行，/场子节点不纳入；去重矩形top不是1即记录wrappedQuoteAmounts（含完整金额文本），写JSON后要求空。仅两类quote选择器，不扩大到其他金额/表格，不删旧小数fixture或修改业务源。services对应纯样式修复和两份真实profileView派生样本需一并集成后跑最终候选，169旧结果不冒充170。

金额片实际验证：转换后的服务报价为直接文字¥300.00加独立span单位，总价为完整¥330.00，已确认Range所选节点正确。选择器限定.profile-quote内部；tsc、Prettier、diff和Playwright2628注册均通过。未执行本地浏览器，新金额原子守卫等待整合后的真实CI矩形验证。
