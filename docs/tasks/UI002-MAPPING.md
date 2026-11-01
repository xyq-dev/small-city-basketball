# UI002-MAPPING：设计与源码覆盖映射

状态：IN_PROGRESS / LOCAL_ONLY。负责人：Codex ui_mapping；集成人：root。记录时间：2026-11-01T14:42:07+08:00。

## 实际上下文与所有权

目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-mapping`；独立分支 `work/ui002-mapping`；基线 `803c1398d752df7e7ede56240729de1260c7550e`，初始clean；远端 `https://github.com/xyq-dev/small-city-basketball.git`。已读AGENTS、CURRENT_STATUS、TASKS、COLLABORATION、UI002当前任务和UI001设计/索引，核对实际app.json。

仅拥有 `docs/design/UI002_IMPLEMENTATION.md`、`docs/design/UI001_SCREEN_INDEX.md`顶部说明/文末新增5路由及自己的任务/交接。应用、测试、其他任务/汇总和契约不改；由root串行同步，本子任务不push/main，不部署/生产，不编写或执行Migration。

## 已写入

200个唯一画板ID逐项映射，保留角色、状态、尺寸和差异；73路由反向覆盖，补旧68路由索引的5个消费者。区分源码去向、Figma代表上下文、VM/模板、兼容PNG、微信真机和外部渠道。

保险关闭态与原单核对已接线，OP01独立1440运营后台不属于本轮小程序开放范围，真实adapter阻塞；T2青少年培训/培训监护及课包关闭；E07私有技术统计不公开；AD桌面管理稿按现有移动权限适配并默认隐藏配置。

## 验证

初始803c139基线已静态核对200个唯一画板、73个唯一路由及每条JS/WXML/JSON存在；当时5路由无独立WXSS而复用全局样式，最终文件复核以本卡下方检查点为准。提交前继续检查原索引200行不变、相对链接和diff。未重跑应用CI/浏览器/微信真机/真实API或外部渠道，本片不能替代代码域验收。

## 下一步

本地检查提交后发root串行同步，root依据最终整合HEAD补真实验收结果。未验证不标200全完成或main DONE。

提交前静态验证通过：200个唯一画板ID与原索引精确一致、73条唯一路由覆盖、200条原画板行不变、相对链接逐条存在；`git diff --check`通过。应用与视觉测试未执行，代码结果由root按最终HEAD汇总。

## 最终路由文件复核

2026-11-01T14:53:06+08:00；独立目录 `/workspace/scratch/5a4363d2d0b7/scb-ui-mapping-final`，分支 `work/ui002-mapping-final`，基线 `9adc72917a129fa0c42e58419008da68ca2eab8a`，初始clean；root已集成服务域最终六路由片。本次只修改原有4份Markdown。

实际静态复核：200个唯一画板ID、73条唯一路由不变；JS/WXML/JSON全部存在；69页有独立WXSS，event-setup/schedule/bracket/reschedule四页复用全局，match-media已新增页级WXSS。与开工main c22fde9相比73条路由均有UI002源码/模板/样式变更，关闭态/原单回路的实现与正式外部未开放分开描述。当前PR36候选CI、独立Review及最终合并事实待root收口，不在本片标MAIN/DONE。

本片仅静态路径、映射/链接和diff核验，未重跑应用、浏览器、真机或正式渠道；没有Migration/生产操作。下一条：root cherry-pick文档修片并串行同步，按最终CI记录更新集成验收。
