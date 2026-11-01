# UI002-VALIDATION接续

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。工作区、所有权与限制见[任务卡](../tasks/UI002-VALIDATION.md)。

基线283c4f2；已核验无未提交改动。node_modules仅引用root已安装依赖，不提交该链接。旧首页/导航/账号管理fixture与新设计不一致，正在按实际设计和当前UI状态迁移断言。下一步修正合法预期并反馈真实源问题；不放宽通用布局和权限守卫。

首片 2026-11-01T14:41:53+08:00：测试迁移与14份根域fixture已完成。4新增直接用例及75旧根域回归、42组三宽HTML展开通过；tsc通过；完整原生测试仍有15项已定位失败（1源箭头、14旧SDK工具来源/selector），已交root对应修复，不能标DONE。浏览器三宽/PNG及微信真机未执行。当前依赖fc82be1/314f017分别是root44911ea/e70fbb8的本地副本，root只取本片最终commit，不重复取依赖。

2026-11-01T07:29:34Z：CI167 read-only复核取run41283836322/admin124781055260原始日志与artifact13074294448，原图/metrics在scratch ui002-ci167-evidence。失败候选1319pass/9fail不能作为最终验收；布局原图复核暴露4页双header，已交services修配置。root随后直接核Figma T09/T17并授权仅迁移预约两组精确16px几何、卡r16、按钮16px/r12/至少48/navy；其他旧几何守卫保留。全矩阵增加scb-header与原生导航不得共存，布局JSON输出各计数。

续片分支work/ui002-validation-followup基线86e503b；两份normal home fixture改用实际工具生成NATIONWIDE snapshot及合成已加载赛事，不再用data={}冒充normal。未改源实现、权限、harness或CSP；root负责合入对应源样式、四页custom配置、placeholder修复及后继完整CI。未执行微信/真机或正式外部服务。

续片本地验证：`node --test` ui002-root/c11-shared-ui/c10-core-state-consistency合计11/11通过；两份正常首页在320/390/430的6次模板展开均出现active全国、切换城市及合成赛事，所有资源非空。`npx tsc --project tsconfig.tests.json --noEmit`、三份变更测试/fixture的Prettier及git diff --check通过；Playwright `--list`成功注册2628用例（含按配置跳过的mobile原生项目），仅为注册检查，不冒称运行。当前源基线仍未含services后继样式/JSON修复，因此浏览器执行必须交整合后的精确CI。

2026-11-01T07:30:34Z 独立review纠正续片遗漏：通用非home action12px在booking两组16px前执行，形成互斥。仅让这两个设计迁移group跳过旧12px，其他三组及通用height≥48不变，未弱化溢出/触控/字体/照片守卫。后继小提交基于738431b，需与上片一起集成；后继完整CI才是浏览器验收证据。
