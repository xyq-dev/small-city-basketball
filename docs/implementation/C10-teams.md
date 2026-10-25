# C10 球队与报名视觉还原

2026-10-25 Asia/Shanghai；作者c10_teams；工作树`/workspace/scratch/608836f8d204/c10-teams`，分支`feat/c10-teams`，基线55d5dd9。仅修改本域五页、展示用合成fixture和直接回归。共享状态/权限/API/费用与后端均未改；没有push、部署或Migration。

## 原稿与页面映射

高保真上下文及截图已重新读取。文件均为`2jAHpYjdIHqal1nXeoVqm6`；原稿文本/PNG留在`/workspace/scratch/608836f8d204/c10-team-design-context/`，root可按下表选入整套报告。没有静态位图或SVG资产；文字圆形队徽按原稿组件使用当前球队名称首字，不是假个人照片。

| 路由 | 主原稿/PNG | 其他状态原稿 | 还原及必要派生 |
|---|---|---|---|
| teams | 9:818 / `9-818.png` | 11:8、11:36、11:54 | 对应T01：24px内边/12px圆角边框面板、40px文字队徽、20px节奏、独立44px按钮。单机构不占首屏选择器，多机构仍可切换；不伪造原稿示例的本届待补记录。 |
| team | 9:863 / `9-863.png` | 编辑9:936 | 对应T02/T03：成员表、成员/报名入口、独立管理和编辑按钮。可明确展开/收起编辑，草稿保持，忙/未知/无权时不可切换。长期DTO未采集球衣号，表中显示“本届设置”，不把原稿07/12/00当实际长期号码；没有历史API，不造可点击历史标签。 |
| registration-events | 9:982 / `9-982.png` | 11:8、11:36、11:54 | 对应T04：赛事标题、状态、报名按钮与规则/独立审核说明；只显示当前真实事件日期/规则，不编造“8队”或其他未提供规格。已存在报名保留进入旧单及真实退回原因。 |
| entry | 9:1028 / `9-1028.png` | 资料9:1095、核对9:1139、进度9:1195、已提交17:571、只读9:1300 | 同一原生路由按原有stage复用四稿。首屏优先当前阶段内容，阶段切换放内容之后，保留名单草稿；真实名单、号码、私有文件、声明和历史均由现有字段驱动。上传不冒充身份/保险核验。APPROVED且canEditRoster=false覆盖只读能力，DTO没有单独“已冻结”标志，因此不伪造冻结状态或冻结版本。 |
| invitation | 9:1248 / `9-1248.png` | 输入9:936、权限11:54 | **派生**：保留原稿邀请概要/条件/44px操作；现有API无邀请预览读取，接受前不能读取被邀请球队/角色/有效期，因此显示当前目标账号与实际编号/凭据输入，不伪造原稿的球队名和角色。新增会话读取loading仅为展示。凭据继续只在内存并在隐藏时清除。 |

通用反馈参考11:36（读取/失败）、11:54（无法访问）；这是桌面宽状态组件，按移动端卡片复用，不称逐像素整屏一致。既有native导航标题保留，页面内重复大标题移除。全部五页复用scb-nav，传入busy/loading/未知结果/未保存草稿的disabled条件，由root统一实现共享导航门禁。创建输入提供明确取消，球队和名单草稿提供经原refresh确认的取消出口；不能因禁用导航把用户困在草稿。

## 合成场景覆盖

34份`tests/mini-program/fixtures/c10-team-*.json`。顶层包含route/state/figmaNode/expectText，合成数据仅供布局，不进入产品网络或运行初值。

- teams：ready、loading、empty、error、permission。
- team：ready、edit、loading、empty、error、permission。
- registration-events：ready、已有退回报名、loading、empty、error、permission。
- entry：DRAFT、资料文件、提交核对/未勾、SUBMITTED、CHANGES_REQUESTED、APPROVED只读、保险要求未满足、loading、empty、error、permission。
- invitation：ready/未勾、accepted、loading、error、permission、revoked。没有独立空邀请详情API，“未提供凭据”由正常输入态表达，不虚构邀请详情。

## 实际检查

- 已执行102份三宽真实模板兼容HTML生成（34×320/390/430），所有expectText存在；不是浏览器几何或微信验收。
- 原生全量235/235通过（原232+本域新增3），含长期编辑折叠草稿/权限与忙锁、邀请读取不自动接受、报名只读与未满足保险仍禁止提交。直接球队/报名/结构回归69/69。
- 新截图和320/390/430实际浏览器测量由root在集成候选统一执行。未执行微信开发工具、真机、原生文件选择/安全区，未声称视觉逐像素全部签收。

## 主截图索引

五个ready fixture均已设`primary:true`：teams→`c10-team-teams-ready`→9-818.png；team→`c10-team-team-ready`→9-863.png；registration-events→`c10-team-events-ready`→9-982.png；entry→`c10-team-entry-ready`→9-1028.png；invitation→`c10-team-invitation-ready`→9-1248.png。原PNG统一位于上述scratch设计上下文目录。
