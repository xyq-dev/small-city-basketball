# R6MATCH 交接

状态 IN_PROGRESS / LOCAL_ONLY。基线及允许范围见[任务](../tasks/R6MATCH.md)。2026-11-01（Asia/Shanghai）正在实现第一切片。

共享接线：MatchingSourceHooks.prepare在需求锁前获取原源日历/资源锁；返回execute闭包在同事务创建原业务单。缺真实hook明确拒绝转换，不模拟成功。页面注册及app.ts由root负责。

未执行真实PG、真机和生产；新044迁移未执行。后续继续实现SQL持久服务、控制器和UI。

切片1已可审查：MatchingService、MatchingController和044迁移，构造第三参`{enabled,sourceHooks}`默认关闭。API前缀`/v1/matching`，控制器共9条路由；读工作台/详情/回执，写授权/需求/匹配/意向/需求命令/意向命令。共享api.js白名单与app.json/UI菜单由root负责。单测14项及API typecheck通过，真实PG仍未执行。

实现边界：一个需求为一个角色×人数（最多16），成人球员可最多64个确定时段且同一席位同一人；工作人员及约赛一个时段。新订单为原流程初始REQUESTED/OPEN，意向不是占档。供给主动选择明确地区，现有公开档案不自动授权。候选未核验的交通与可靠性维度为null；总价未知必须先在原服务确认报价，跨城直接转换拒绝进入本地单。源锁→授权锁→需求→席位→意向；同事务hook失败整笔回滚。这里只持久站内事件，不接外部消息发送。
