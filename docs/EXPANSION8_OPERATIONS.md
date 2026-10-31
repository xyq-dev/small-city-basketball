# 八项扩展运行边界

当前分支源码已接线，完整隔离验收仍在进行。生产未更新，正式支付、保险、微信通知和推流均未实际调用。各域进度见[总任务](tasks/EXPANSION8.md)。

## 配置与默认行为

| 能力               | 运行入口                                                                                                                                                                                                  | 缺配置时                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 统一搜索、站内消息 | 已有公开授权；通知DB调度默认15分钟，`NOTIFICATION_STARTING_LEAD_MINUTES`支持1—120                                                                                                                         | 搜索只返当前公开结果；缺微信配置仍可站内读取                  |
| 微信订阅           | `WECHAT_NOTIFICATIONS_ENABLED=true`、现有已启用小程序身份配置、`SCB_NOTIFICATION_DATA_KEY`、`WECHAT_NOTIFICATION_TEMPLATES`                                                                               | 微信外发关闭；不会把关注或客户端accept视为送达                |
| 业务交易           | `SCB_TRADE_ENABLED=true`、`SCB_TRADE_DATA_KEY`、`SCB_TRADE_MERCHANTS_JSON`；精确格式见[trade运行时](../apps/api/src/trade-runtime.ts)                                                                     | 新业务收费执行关闭；已有绑定的未付/退款/争议门槛继续有效      |
| 直播/媒体          | `SCB_STREAMING_ENABLED=true`、`SCB_STREAMING_CAPABILITIES_VERIFIED`、组织绑定`SCB_STREAMING_TARGETS_JSON`、`SCB_STREAMING_DATA_KEY`、CSS配置/密钥和费率；见[运行时](../apps/api/src/streaming-runtime.ts) | 开播关闭；已知STOP仍优先尝试确认，未知保留槽位                |
| 在线保险           | 服务端注入选定供应商的`InsuranceProvider`及独立数据/notice密钥；见[端口](../apps/api/src/insurance-provider.ts)                                                                                           | 尚无选定实际供应商adapter，默认关闭，保留已有外部保单人工审核 |
| 青年监护           | 现有`SCB_PARTICIPANT_DATA_KEY`及赛事显式青年政策                                                                                                                                                          | 成人/旧流程依原规则；已知<14资料处理须当前监护数据预同意      |
| 注销               | 真实六域hooks统一装配；当前密码及安全版本                                                                                                                                                                 | 缺任何完整hook不能发起，未决交易/保险/停流/履约仍阻塞         |

支持密钥文件的配置使用现有`NAME_FILE`秘密读取机制；不要把密钥提交git或放在小程序storage。交易商户/接收方仅由服务端运行配置绑定，历史merchant key保留原主体用于旧单查询和退款；不可用旧key换主体。JSAPI采用服务器交换的当前微信身份，客户端只传一次性`wx.login` code。正式供应商协议、商户分账/回退关系、小程序直播类目/隐私声明、模板与外站账号准入需要在实际服务账户完成联调；源码合成协议测试不能证明正式准入。

## 后台执行与隔离

`SCB_BACKGROUND_WORKERS_ENABLED=false`关闭自动后台任务，保留正常服务的显式业务合同。隔离恢复验收使用这个开关和可信内部按原订单/source限定的drain，不放宽全表指纹。正常默认开启。新直播worker只在API初始化成功后启动，退出等待本实例实际媒体进程终止。

恢复写入的永久`audit_logs(action=RESTORE_QUARANTINE, resource_type=restore)`在每次API启动检查。命中后旧微信登录、套餐支付/邮件以及新保险、资金、推流、微信通知、注销的外发配置和自动任务均关闭；普通API不能清除marker。隔离保留外部PAID/退款/分账、保单、云入口停流和占槽事实，未知结果保持UNKNOWN，不通过清slot、伪造FAILED或source_stopped来假装完成。生产启动继续要求完整schema/权限/密钥校验；开发数据库不可验证时仅保留纯HTTP边界，外部运行能力关闭。

## 媒体持久化与恢复

API镜像内置FFmpeg/ffprobe和中文字体；生产compose为UID10001建立`/var/lib/scb/live-media`并挂载独立`live_media`持久卷。`SCB_LIVE_MEDIA_ROOT`必须是专用绝对路径。卷保留API容器重建前后的录制字节；容量、备份位置及可用空间由部署实例配置，不能把临时目录当整场录像存储。

数据库dump仅备份媒体元数据和内容哈希，不包含MP4文件。恢复媒体需另行保留与数据库检查点对应的媒体卷归档，在隔离目录校验每个artifact的大小/sha256后再供应用读取；不得仅凭表行数宣布录像恢复。缺失或哈希不符的文件不可公开或交付。永久恢复marker及旧链接撤回继续生效，媒体文件恢复不自动恢复公开许可或推流。当前本轮验收覆盖DB精确恢复及受控媒体内容哈希，尚不宣称真实存量媒体卷已归档恢复。

## 迁移与验收

完整链001—042包含176张表、117个函数；036—041已在隔离CI41182154976首次成功执行并冻结，042成年本人资料处理再同意已在隔离CI41184782485首次成功执行并冻结。权限由精确manifest授权：新事实历史/receipt不可普通修改或删除；审计runtime仅允许INSERT及action/resource_type两列SELECT。

验收分源码/类型/构建、真实PG/并发、原生页面到HTTP、320/390/430兼容布局、非空重启及dump/restore。`live-pusher`和`web-view`在兼容布局中仅为显式占位，不代表相机、真机或真实供应商页面已经验收。当前真实外部、正式微信工具和生产状态始终单独记录。
