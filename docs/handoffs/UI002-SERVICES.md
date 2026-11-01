# UI002-SERVICES 接续

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。独立目录 `scb-ui-services`、分支 `work/ui002-services`、基线 c22fde9；初始 clean。范围及授权见任务卡。root 是唯一集成人。

已实际读取 NM03 高保真 Figma context+截图，四个额外节点并行读取无返回后已终止，未以其作为已读证据。首片撮合分阶段呈现正在实现；直接 VM、WXML、320/390/430 与集成仍待验证。没有后端/Migration/生产或正式渠道操作。

下一步：运行撮合既有回归与新增分步视图测试，提供首片提交给 root；其他服务域逐项核对当前代码和可取得的设计上下文。

首片验证：`node --test apps/wechat/test/r6-matching.test.cjs apps/wechat/test/ui002-services.test.cjs` 13/13通过；新增需求公开范围审阅/返回编辑不写API、未决原编号跨页保留、换账号清除审阅同意。WXML真实组件静态渲染、JS语法、定向Prettier和diff检查通过。新增候选/关闭/UNKNOWN三个合成布局样本；320/390/430浏览器、当前HEAD完整CI和微信真机尚未执行。

独立审查修复：matching换账号完整清除私有需求草稿、地址/地区/时段/合同、报价预览/球场选择及收费资格同意，并关闭旧账号capabilities；仅清页面pending引用，旧actor持久原编号不删除。新增VM复现A草稿不能由B重开；定向14/14通过。培训下一片仍在本地实施，不混入此安全修复。
