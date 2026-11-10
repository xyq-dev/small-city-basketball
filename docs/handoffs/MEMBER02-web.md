# MEMBER02 Web 实施记录

2026-11-10 Asia/Shanghai；owner /root/membership_web；REVIEW / LOCAL_ONLY。

现场：`/workspace/scratch/dc6a786e1a31/scb-member02-web`，分支`feat/MEMBER02-web`，基线`b58ac0291e0cceacbaa2c6b42b0c473a16ff1ef4`（前置ac6f700）。origin原xyq-dev/small-city-basketball；开工干净，原工作树保留。root集成人持App路由/shared contract接线，backend持会员数据/财务守卫。

允许：新增admin membership模块/CSS/测试、新api/membership.ts与测试、合成fixture与本记录；禁止改App.tsx/原commerce/shared contracts/后端/全局CSS/依赖/原生小程序/生产。独立精确commit回报root，不push。使用用户已确认的Figma V1（page135:2，desktop137:120，phone137:330/137:396），已实际查看导出3屏；Web复用原AppShell，手机响应式不画微信胶囊。

当前：已读真实代码和商业规则，已向backend请求冻结契约；尚未实现API消费者，不创建自定义不一致DTO。准备独立视图结构及局部样式，待合同冻结后接真实workspace/命令。未执行测试、截图或真实PG/支付，不填通过。无Migration或生产操作。


## 2026-11-10 16:08 Asia/Shanghai 检查点

已读取并精确cherry-pick core合同68157b4、root出口9c266fa，补合同c8e0693（机构名、四类截断标记）。原生Figma视图转换为真实Web内容区和手机响应式，不画微信胶囊。主要页面/平台模板/订单动作/周期与用量、服务端报价/资格、409和未知结果阻断、上下文网络abort及API边界已编写，接口边界35项响应单测已通过，组件回归待执行。首次类型检查只发现API unknown窄化和合同机构名未到位，前者已修、后者随合同更新；完整类型/构建尚未通过，不填成功。

依赖采用本工作树自建node_modules外部链接目录，每项指向只读已有依赖，@small-city-basketball/contracts单独指向自己的packages/contracts，未更改任何共享node_modules目标；避免旧scb-tmx合同掩盖错误。临时链接不提交，后续清理仅删除本工作树创建的链接。


## 2026-11-10 16:16 Asia/Shanghai 可审查切片

已完成的独占文件：api/membership.ts及边界测试；membership/MembershipPages.tsx、组件、局部CSS、平台建议模板与合成fixture/组件回归。导出OrgMembershipPage(context)和PlatformMembershipPage(client,userId)，root接`/membership`与`/platform/membership`，本作者未改App/旧commerce/shared contracts/后端/全局主题。

流程：机构方案月/年本地切换；只认服务端canPurchase及purchasablePlanIds，真实已发布价格/版本；核对付费机构、全期额度/每届限制与手动续费方式后明确确认下单（只提交commandId、planId、expectedMembershipVersion）；创建待付和二维码不假称已付款。会员订单复用原命令能力，人工双人核验/原单查付/未使用全额退款/原退款查询。平台4档建议仅在确认后替换本地草稿并保留原因，再独立发布不可变会员套餐，成功后切到对应周期展示。周期状态/有效窗口与全期剩余取服务端，历史4类截断提示明确，不用列表条数计算余量。401/403/409与未知写结果阻止重发，保留原因，显式重读；机构/用户切换卸载旧页、abort本页请求并忽略旧响应。购买不升权。

实际验证：

- `npm run test --workspace @small-city-basketball/admin -- src/api/membership.test.ts src/membership/MembershipPages.test.tsx`：2文件61/61通过（39 API边界、22交互/状态；全部为合成响应单测，不是商户或真实PG）。
- `npm run test --workspace @small-city-basketball/admin`：72文件773/773通过。
- admin完整typecheck通过；局部源码/CSS prettier与diff检查通过。
- admin build通过并保留既有500kB chunk提示；本树App接线仍由root另树持有，此独立构建不代表新路由已打包，root整合后必须再构建/验收。
- 首次组件测试2失败：异步重读尚未完成时测试读取旧空列表（改为等待服务端返回的新订单文字），以及真实输入标签混入说明文本（已增加明确aria-label）。修复后61与完整773重验通过，没有改验收权限或资金状态。

未执行：新模块真实PG/HTTP、桌面/手机浏览器、运行截图与Figma像素对照、微信真机/Safari、真实支付、生产。root正在编写独立ENFORCED真实API浏览器suite，全部由整合候选CI取得证据。设计参考覆盖1440×1040与390×844；应用金额使用既有CNY两位小数/千分位，真实套餐名称替代示例文本，不声称像素一致。原生微信会员页面仅Figma，本切片只Web响应式。

Migration：本作者未编写或执行。Git：仅精确提交上述新增9路径，不push；共享契约来自68157b4、root出口9c266fa、补充c8e0693，本作者不自行改合同。下一步root只cherry-pick本切片最终提交，接App与后端，核对真实状态和数据，跑同head必要CI与截图，独立审查后再决定整合。
