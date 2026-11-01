# UI002-REGFLOW：报名、办赛与现场记分结构落地

状态IN_PROGRESS / LOCAL_ONLY。2026-11-01 Asia/Shanghai；负责人Codex `/root/ui_registration`，root唯一集成。

独立目录`/workspace/scratch/5a4363d2d0b7/scb-ui-regflow`，分支`work/ui002-regflow`，开工HEAD `a9a3e10ec7793eadc2e1379fb6b776b5e7725ca6`，远端xyq-dev/small-city-basketball，开工clean。保留所有旧工作树，不在market/registration区切分支。已核AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI002当前卡及WECHAT_UI_V2/UI001索引。

独占participant-materials、qualification-precheck、event-setup、entry-review、scorer的WXML/WXSS，以及必要纯显示JS/原命令dispatcher、新自有direct测试/fixture和本任务交接。validation单写旧共享native/E2E/catalog迁移；root单写资产及汇总。禁止服务端命令、权限、资金、路由、Migration、pack、部署或生产操作。

设计依据同Figma会话8360f3e4-19ce-4b52-bc6a-28aed7cc9b9b，file BSQ64CrDTJ2P4tOIowOSFk。已重新读figma-design-to-code技能，直接读取R03 6:492/R05 6:609/O05 6:1174 metadata；已看缓存R03 Steps6:505/Form6:515、O02 Form6:1037、S02全图与8:580/587/594/634高保真context/截图。新增实际高fid/截图：R03必要资料6:525，R05确认6:635、后续办理6:643、当前版本6:632。前次五并发context长等待取消，无产出，不当作已读依据。

分片：R03/R05（步骤后直接本人表单、必要资料cells、真实checkbox、固定当前目标预审）；O02/O05（基础配置/3步骤分区保存、审核队列与当前独立审核固定动作）；S02（紧凑深蓝记分板/两组+分/三专业cells及展开区/准确固定结束动作）。每片单独验证、提交，root串行同步后继续。

保持全部原字段、handler、payload、版本、写锁、原编号恢复和离线冲突；错误、未决和当前目标不能被分区隐藏。R05仅增加显示选择，固定request仍从本次workspace重找member，不信展示对象；loading/切目标/失权/actor变化清选择与本次同意。checkbox不表示独立审批。S02不把结束与提交复核合并成新事务。

验证计划：新增实际Page VM覆盖纯显示切换与原命令门槛；新fixture包括O05正常可审而非只冻结；320/390/430原生模板/异常状态与解析、格式/diff。浏览器/PNG及最终精确CI由root/validation核，官方微信/真机及真实外部通道另验。


## 首片：R03/R05本地可验证实现

R03取消正常态重复大标题、赛事前导卡、5tabs和两条大导航，将3steps后直接排列本届成员/姓名/证件字段，必要资料的22px相机/盾与16px箭头cells转原portrait/consent分区；确认两checkbox和真实私有用途提示保留。身份证格式/脱敏/照片和保单上传限制及完整签署文本保留在对应分区；原错误/pending常显。保险分区固定保存继续走saveInsurance，其他分区仍save；冻结只读增加明确进度入口，原宣传撤回仍可达。输入保16px和44px实际控件，字段会比概念稿14px展示值的74px卡增高，不压缩触控或截断真实文字。

R05恢复原生checkbox，显示当前资料版本与缺失/预审状态，后续外部保单cell复用受控materials insurance导航，在线保险明确关闭。新selectedParticipant仅供显示：只在当前新workspace恰一个canRequest时默认选择，多目标显式选；切目标、开始读取、hide/换号清对象与本次consent，读取时清旧workspace/userId防失权旧对象复活。固定动作带当前memberId走原request，命令仍从本次workspace重找，payload、原编号恢复和独立review/write/send完全保持。真实审核仍逐人确认，不用checkbox代审批。

R03/R05实际Figma静态图标复用root提供原account-camera.svg/account-shield.svg（原22）和chevron（原16），等待root对新URL哈希最终核一致；没有用设计整图作运行资产。

新增ui002-regflow.test.cjs实际Page直接与三宽模板8/8通过，含保单草稿跨panel保留、checkbox重复change不反选、目标切换与pending、fresh workspace版本原payload、迟到读/换号/失权、原外部保单受控路由及3份真实状态合成fixture。全73路由native结构/显式绑定79/79通过。原C23/E03 41项执行40通过，唯一旧c23-materials-draft首个expectText“填写本人参赛资料”因重复大标题删除而不再存在；字段、照片、私有、保险及签署断言仍保留。validation单写旧fixture迁移，不把此旧视觉期望当业务通过，也不隐藏失败。

尚未本地浏览器/官方微信/真机；字段几何、320/390/430PNG与最终精确候选CI待root/validation。未push或部署，无Migration。下一片O02/O05，仅在root首片同步后继续。
