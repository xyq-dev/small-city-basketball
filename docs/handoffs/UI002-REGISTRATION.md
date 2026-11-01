# UI002-REGISTRATION 交接

2026-11-01 Asia/Shanghai；REVIEW / LOCAL_ONLY，待root整合及当前候选CI。

独立目录`/workspace/scratch/5a4363d2d0b7/scb-ui-registration`，分支`work/ui002-registration`，基线`c22fde9`，初始clean；已核验远端为xyq-dev/small-city-basketball。root只负责共享组件、五导航和汇总，本分域仅写自己的业务前端路径、直接测试及本任务/交接。

当前先实施本人报名步骤与真实资料流程，保留本人资料/队伍报名/资格预审/保险/监护/最终冻结的独立事实。无需新增后端或Migration；无生产及外部通道操作。

设计：R03实际截图与表单子层6:515高保真context已获取，无资产；其他整屏首次context超时，不能宣称全量视觉核验。下一步完成首片及直接VM后，将本地提交SHA交root串行同步，再继续下片。

首片已完成：participant-materials步骤与5个显示分区、保护草稿离页、预审步骤回路和加载/空状态。root基础组件已cherry-pick到e2e01e8，未自行改共享文件。新增4个合成fixture与8个直接VM/模板用例，C23/e03/native-structure合计123/123通过；格式及diff检查通过。没有新增后端/API/Migration，真实API、浏览器布局、微信真机和外部通道本地未运行。

下片：org-event按真实capabilities分组工作台；event-setup向导、scorer显示分区，保留原控制权、离线队列与独立复核。已取得6:964工作台身份卡、8:580比分台及5:800球队身份卡的高保真context；球队卡含shield SVG需下载并核验后使用，不能以临时Figma URL运行。

首片独立审查修复：保险分区固定按钮明确调用saveInsurance；跟踪保险字段dirty并在任何资料保存/上传时合入已编辑patch，防止跨分区保存重置保单表单。3项新增VM覆盖PUT body、脱敏成功返回、422后保留非敏感编辑；定向126/126通过。首片c0accd5已由root同步远端整合分支；本修复单独提交交root同步。

第二片已落地：31条分域原生路由统一自绘header和custom导航配置、品牌token、可读表单；org-event有序工作台/展开工具；event-setup设置定位；entry四阶段；scorer比分优先及阵容/离线/原事件导航；T02真实球队身份卡使用原SVG及同源PNG。保留全部原API、capabilities、CAS/lease/fence、独立同意/复核及资金/未知结果事实。

17个UI002-REGISTRATION合成fixture覆盖首片4个、原缺样本5路由的10种正常/异常态、记分台、长队名及管理邀请关闭。T02管理邀请签发仍Web-only，经root确认不扩原生transport；有权用户看到明确关闭态，不能把加入码当管理授权。

第二片定向176/176通过，最新定位/长文案补片直接53/53通过。完整本地native回归1106通过、1项既有Windows专属跳过、0失败；未把模板生成称为浏览器几何通过。默认Chromium executable不存在，须由root隔离CI测320/390/430几何及PNG。无本地PG/真实API、官方微信/真机、真实保险/资金/直播测试，无Migration、pack、部署或生产修改。

root下一条操作：cherry-pick本片提交，核验仅分配前端/样本及本任务文档，串行同步后启动精确候选完整CI；重点核对固定操作区、长队名头像槽、管理工具展开、工作台/记分路由和17个新样本的业务语义。首片及b2c300e审查修复已同步，不要重复认领为第二片变更。

root回报最终代码已同步远端c5c0f10d/PR36，整合原生测试1128通过、1个既有Windows跳过，精确候选CI和独立review进行中。本次原worktree的HEAD5885747、初始clean，仅按UI001索引补15份fixture的figmaNode；额外纠正继承旧C10节点的管理邀请关闭样本为5:787。17份样本全部可追溯，本次16份JSON除figmaNode外与HEAD内容相等；data/expect完全不变。只做追溯元数据和格式/diff检查，没有重复整套测试，也没有新的功能/生产操作。小commit交root串行同步即可。

追溯首片e92ca38已交root。随后按root/validation指示将recruitment-unknown的节点纠正为索引已核实的O04 6:1124，将scorer-console合成静态样本的state从real-api改为synthetic-populated；不更改static、data、expect或真正的API测试。仅元数据/格式/diff检查，独立小commit交root整合，不重复全量验证。

CI162修复检查点：开工本地work/ui002-registration@d3f2577、clean。root/validation已取旧CI162原始metrics，三份320px球员列表的playerCard.y均200→204，定位为.filter-chip的height44被全局min-height48覆盖。本片仅补显式min-height44；不改y200或触控44守卫、不改其他域。只做原有球员UI/基本解析及diff检查，无本地浏览器几何验证；交root精确候选CI复验。旧CI162取消前的失败不记作当前候选成功。
