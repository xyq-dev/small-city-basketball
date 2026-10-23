# C02 公开赛事导出与海报

2026-10-23（Asia/Shanghai）；负责人：event_exports；REVIEW / LOCAL_ONLY，待root整合与浏览器核验。

## 现场与范围

工作树 `/workspace/scratch/dc6a786e1a31/c02-export`，分支 `feat/C02-export`，基线 `153421668ea74378df859a4b7c21df7da11ad77e`，开工干净。仅修改 `apps/admin/src/viewing/**` 及本记录，不改API、契约、数据库、其他Agent文件。不commit/push、部署或访问生产。

## UX与数据规则（实现前记录）

- 公开赛事页提供完整已读取赛程CSV、每页8场SVG赛程海报；单场页提供比分SVG和单场CSV。提供海报预览及打印样式，说明生成时间、数据时间和静态快照属性。
- 复用现有公开API，赛程本来就受控逐页完整加载。每次导出先重新读取授权资料；分页失败、缺场或重复场次均拒绝，不把部分数据称为完整赛程。
- 仅投影公开展示字段，不序列化整个DTO；不导出ID、授权URL、Cookie、令牌、内部机构/球员信息。SVG仅固定图形与转义文本，不含外链；CSV单元格转义并保护公式前缀，文件名净化。
- 已知404撤销/源损坏后清除内容及预览；离线或陈旧资料不可新导出。每次重新生成都复核授权；已下载文件不能远程撤回，界面明确说明。
- null比分/时钟显示未采集，不伪造0或正式结果；比分区分正式、待确认及待重新确认。时钟为按原权威锚点计算的导出瞬间静态估计，不导出“实时计时器”。
- 不添加专业球员统计、直播视频或外部上传服务。SVG/CSV由浏览器本地生成，无新增付费资源。

## 已实现

- `exports.ts`：本地CSV/SVG生成、CSV公式防注入、SVG文本转义/控制字符过滤、安全文件名、完整赛程/重复场次检查、按权威锚点生成静态计时快照、Blob下载与URL释放。
- `PublicExports.tsx`：赛程海报页码、完整CSV/本页SVG下载、单场CSV/比分SVG、海报预览及打印入口。每次输出重新走公开API；不会上传资料或依赖外部服务。
- `PublicPages.tsx`接入两种工具栏；`usePublicResource.ts`增加受限invalidate，导出复核发现404/源损坏后立即清除资料、取消旧轮询并防止迟到成功恢复旧内容；离线/陈旧禁导出。
- `viewing.css`：桌面/手机按钮布局、海报预览及A4打印样式。

## 实际验证

- `npm run test --workspace @small-city-basketball/admin -- src/viewing/exports.test.ts src/viewing/PublicExports.test.tsx src/viewing/PublicPages.test.tsx`：3文件、31测试通过。覆盖公式/SVG注入、私密字段排除、分页/缺场拒绝、null与0、权威计时、Blob清理、重新鉴权、404及源损坏清屏、离线迟到响应、打印入口和旧poll竞态。
- `npm run typecheck --workspace @small-city-basketball/admin`：通过。
- `npm run build --workspace @small-city-basketball/admin`：通过，生成生产静态包；这不等于生产部署。
- Prettier已格式化本轮8个源码/测试/样式文件；`git diff --check`通过。
- 初轮2个UI测试因重复复用已消费Response fixture失败，改为每次返回独立Response后通过，未放宽断言。

## 未验证与限制

真实浏览器下载、390px布局、SVG实际字体/打印预览仍由root整合后核验；本Agent的jsdom断言不冒充浏览器实测。本批导出格式为SVG/CSV，未实现PNG、PDF或视频；没有数据库变更或Migration。下载文件是不可远程撤回的静态快照，按界面说明使用。

没有commit/push或部署，HEAD未变化；9个本轮文件仍为本工作树本地改动，root按明确文件范围集成。
