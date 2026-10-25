# 在微信开发工具中验收六屏UI

当前阶段优先核对真实微信模板渲染。该入口启动**隔离的合成资料副本**，不接生产API，不进行预约/登录/支付/上传/发布。原项目`apps/wechat`不变。

## 本地执行

在本项目Git仓库根目录，用Windows PowerShell执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\accept-wechat-ui.ps1
```

先安装Node.js >=22.12与官方微信开发工具，并在开发工具中完成登录、开启“设置→安全设置→服务端口/CLI调用”。这些本机操作不能由当前云端代办。脚本会尝试常见安装路径；自定义安装位置时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\accept-wechat-ui.ps1 -CliPath 'D:\你的实际安装目录\cli.bat'
```

默认保留仓库的`touristappid`。若目标开发工具不支持游客项目自动化，使用本人已有开发权限的AppID（无需AppSecret）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\accept-wechat-ui.ps1 -CliPath 'D:\你的实际安装目录\cli.bat' -AppId 'wx你的真实AppID'
```

示例路径和AppID必须替换为本机实际值。AppID只写入本次验收副本；脚本不修改正式项目配置、不创建新凭据。遇到扫码或开发工具授权提示，由当前开发者在本机完成。访客模式能否自动化仍需目标工具实测，准备成功不能当作已连接。

依赖独立安装在`tools/wechat-ui`，使用锁定的miniprogram-automator 0.13.0，不进入小程序包或后端依赖。Windows通过独立PowerShell脚本调用CLI的`auto`命令，再由SDK连接本机回环地址，避免Node直接spawn批处理的EINVAL问题。安装/项目路径支持空格与中文；含批处理控制字符的路径会明确拒绝。入口不调用upload/preview发布命令。开发工具窗口保留供人工查看。

## 输出与判定

脚本打印`artifacts/wechat-ui/<本次时间>/index.html`，用浏览器打开即可逐页对照用户确认稿和原始截图。旁边包含：

- `project/`：可在开发工具手动导入的独立副本，项目名标记为UI FIXTURES ONLY。
- `plan.json`：Git来源、原始运行时文件摘要、fixture来源及未执行验收项。
- `screenshots/`：SDK返回的六张原始PNG，不缩放、不美化；尺寸由当前模拟器决定。
- `report.json`：原始截图摘要、模拟器非敏感尺寸/版本、异常与完成状态。

启动或截图超时、路由/来源标识不符、缺少预期文字、无效PNG、AppService异常都不得记为成功。启动前条件不齐时只输出错误；已建立副本后失败会保留未完成报告。退出码0仅表示六张原生模板截图采集完成，不表示已通过人工视觉签收。

副本保留原始WXML/WXSS/组件/素材，但**替换App和Page的业务生命周期与事件为只读桩**，并把副本API来源固定到不可用的`https://scb-ui-fixture.invalid`；六屏数据来自C11合成fixture。因而只适用于官方模板编译、字体/图片/布局与安全区核对；不用于验证原Page业务逻辑、登录、接口Cookie/Origin、预约写入或真机。真实业务验收须另用经批准的隔离测试副本与合成账号，并按原[使用说明](../apps/wechat/README.md)核对AppID、域名及接口行为。当前原项目API固定来源未改，本轮禁止在生产写入预约或测试资金。不得把本入口的模板桩当作真实业务验收。

截图前在开发工具选择目标模拟器尺寸。需要320/390/430三宽时，逐宽切换模拟器并重新执行命令，各次生成独立目录；本入口不会假装已自动切换设备或修改图片尺寸。

## 只准备副本

没有官方工具时可以执行：

```sh
npm run wechat:ui:prepare
```

它只检查并准备副本，明确报告“尚未执行官方微信截图”。Windows CI检查PowerShell解析、临时批处理的参数传递、SDK加载与准备步骤；截图测试使用SDK替身，同样不代表微信运行时/真机已通过。

SDK依据：npm官方包[miniprogram-automator](https://www.npmjs.com/package/miniprogram-automator) 0.13.0发布包中的README、Launcher/MiniProgram类型定义；微信[快速入门](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/quick-start.html)。2026-10-26查阅时后者无法打开，因此CLI/游客兼容性仍以目标工具运行结果为准。

Windows批处理兼容处理依据[Node官方说明](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2)：本入口不关闭Node安全限制，不把用户输入拼成shell命令。
