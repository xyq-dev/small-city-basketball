# P04-B UI 实施交接

2026-10-23（Asia/Shanghai），负责人`/root/p04b_ui`。**REVIEW / LOCAL_ONLY**，等待root整合、独立审查及真实API浏览器验证。

实际目录`/workspace/scratch/dc6a786e1a31/p04b-admin`，分支`feat/P04-B-ui`，原基线23a49cc，开工clean；共享DTO 0eb318c已单独cherry-pick为c114d77，root已拥有等价契约，整合时只取后续UI提交。没有其他任务dirty，无新依赖、根配置、后端或Migration修改。4张概念PNG维持原稀疏引用，没有触碰。

正式场次卡增加“改期与记录”入口，独立内联工作台显示服务端当前计划、原policy和最近20条不可变历史。只有canReschedule=true且合同合法时展示编辑；UTC+8输入、场地与理由先前后核对，再显式确认。原始publication/history路线继续展示只读原fixture，当前正式列表展示最新安排，说明文字已区分两者。

SCHEDULE_CONFLICT/VALIDATION_ERROR/无变更为明确拒绝，保留表单并定位冲突。版本冲突、网络/超时、5xx或错误200响应锁提交；显式GET成功后仍须点击“已核对最新安排，继续编辑”，读取失败不解锁、不自动重放。保留原输入，未fresh时将旧计划标记待核对。成功POST额外核对目标、Event/Match精确+1及对应历史证明，不把陈旧或错场次200冒充成功。8秒请求截止、卸载取消和请求序列守卫阻止迟到覆盖；StrictMode取消旧GET不影响新读取。展开时聚焦标题，关闭回入口，提交中防双击/关闭；展开期间禁整体重读和直接切换其他场次，改期自身fresh读取可用。

本轮回归发现极快父页重读可能不出现loading卸载，从而保留旧确认；已显式关闭成功工作台后刷新，不依赖异步间隙。首次测试另有日期控件归一化断言及测试fixture共享对象变异，已纠正测试/fixture隔离，不放宽业务断言。

作者本地实际验证：Node24.19.0，`npm run typecheck --workspace @small-city-basketball/admin`通过；完整admin 27文件/237项通过（原202＋新增35：12组件、21HTTP合同、2页面整合），包含冲突定位、fresh失败锁、丢响应已落库后核对、坏200/5xx、只读历史/截断、双击、StrictMode和卸载；`npm run build --workspace @small-city-basketball/admin`成功。改动目录prettier和git diff检查通过，记录以最终提交为准。

没有执行桌面/手机真实浏览器或视觉截图、真实PG、OBS、部署、生产DB/Migration；不能把jsdom当真实浏览器。root已获稳定accessible label并独占真实API E2E。下一步由root整合UI commit、独立审查并执行完整隔离CI；若发现接口偏差先反馈，不自行改共享DTO。
