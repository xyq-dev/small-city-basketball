# C10 离线截图验收打包器

2026-10-25 UTC；负责人 `/root/c10_account`；DONE（工具与实际打包） / EVIDENCE_BRANCH。分配范围仅新建 `scripts/package-mini-visual-acceptance.mjs` 和本说明。工作目录 `/workspace/scratch/608836f8d204/c10-account`，分支 `feat/c10-account`，起点 `fa7e5bf9cfc99215c63145b448b17b83016acdfd`，开工工作区干净，远端 `xyq-dev/small-city-basketball`。此前账号/规划实现另见 `C10-account.md`。

## 使用

先切换 evidence/c10-mini-ui-complete 证据分支（主干文档不附工具）；在包含本轮 catalog、fixture 和21份原稿的仓库中执行；输入是**同一轮** CI artifact 的解压目录。输出须为新建或空目录，且不得与输入重叠。不需安装依赖，不启动服务，不访问网络。

```bash
node scripts/package-mini-visual-acceptance.mjs \
  --results=/absolute/path/to/extracted-artifact \
  --out=/absolute/path/to/visual-acceptance \
  --run=40156690255 \
  --source=486d5d9 \
  --artifact=actual-artifact-name
```

`--run`、`--source`、`--artifact` 为可选的调用者来源记录；工具不自行验证 GitHub run/source，也不从 artifact 推断 CI 成功。`--source` 是被测远端来源，与单独记录的打包仓库本地 HEAD/tree 不混同。其余元数据均从**脚本所属仓库**读取，避免运行目录变化时错误读取另一个项目。

- `apps/wechat/app.json`：必须恰好21条唯一注册路由。
- `tests/mini-program/fixtures/*.json`：读名称、路由、状态、静态标记、Figma来源和期望文字，不把合成 fixture 数据注入产品。
- `tests/mini-program/visual-catalog.json`：version1，21条唯一页面映射，每条包含正常 `ready` 的 `primaryFixture`、标题、Figma node和PNG原稿路径；支持 `notes`、`states`、`notApplicableStates`、`referenceKind`、`referenceSha256`。

原稿路径可相对仓库根目录或为绝对本地路径；不下载远程图片。catalog若给出 `referenceSha256`，须与原件完全相符。

## 输出和守卫

`index.html` 无JavaScript、外部字体、样式或图片资源；以原生 `<details>` 展开适配和状态，可直接离线打开。主目录覆盖21路由，默认并列原Figma与主要正常态390px顶部原图，另可展开320/430px和所有其他390px场景。截图支持原尺寸打开；长页提供“分段1/2…”的原始844px视口截图链接及滚动位置JSON。各段600px步进、重叠保存，不拼接。HTML CSP显式允许本地 `file:` 图片，脚本与网络资源保持禁用。

| 输出            | 内容                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `screenshots/`  | 全部390px场景，加每页primary三宽的真实PNG，保留top、bottom、compare-last-column和严格命名的native-segment变体 |
| `diagnostics/`  | 全部初始/fixture场景 × 320/390/430的原始 `native-layout.json`，另保留所有滚动分段sidecar，字节不变            |
| `references/`   | 21份原始Figma PNG，字节不变                                                                                   |
| `inputs/`       | app/catalog原件，以及不包含fixture data的来源/状态/期望文字快照                                               |
| `checklist.csv` | 全场景三宽、primary标记、原件路径、报告的问题数、N/A理由及待填写的人工签收栏                                  |
| `manifest.json` | 来源声明、打包仓库HEAD/tree、保留策略、逐项SHA256/字节数和完整证据索引                                        |

完整矩阵从当前21初始态加实际 `.json` fixture数计算；本轮197 fixture时为218场景、654份原始JSON，未硬编码654。21条primary各自必须为本路由的ready fixture，三宽缺任一即失败。所有场景顶部截图、长页底部截图、390长页sidecar与预期中间分段、指定横向比较末列截图须齐全。390长页的 `native-scroll-segments.json` 必须与 route/scenario/width一致，viewportHeight=844、step=600、maxScroll为正整数，top为0、bottom为maxScroll；中间段必须完整覆盖600、1200…且严格小于maxScroll。maxScroll≤600可没有中间段。分段文件仅接受 `native-segment-\d{2,3}.png`，顺序/偏移/文件数须与sidecar精确匹配，每张图须为当前宽度×844。sidecar同样按原件复制并记录SHA256。

拒绝未知路由/场景/宽度、状态与当前fixture不符、重复证据、缺JSON/PNG、错误PNG签名或尺寸、缺参考图、参考哈希不符、artifact内symlink及输入输出重叠；不从不同重试目录拼出完整证据。截图验证IHDR尺寸/IEND边界，逐文件记录SHA256并核对复制前后字节；它不代替PNG解码器或实际浏览器视觉检查。manifest哈希清单覆盖除manifest自身以外的全部输出，避免自引用。

原JSON里若已有overflow/smallButtons/unreadableFields问题，仍保留并在页面及CSV明确显示；这类结果不是工具自行执行的测试结论。文件存在和完整性通过不等于UI测试或人工验收通过。默认不复制非primary的320/430 PNG以控制包体，仍保留它们全部原始JSON和源PNG哈希/尺寸/来源索引。没有生成、修饰或拼接PNG。已确认旧 `native-full.png` 在iframe下半裁切空白，故不再读取、要求或交付；不能用它代替分段证据。CSV使用 `scrollSegments` 列，列出sidecar与逐段路径/偏移；manifest单列连续视口分段的来源与非拼接说明。

## 检查与交接

已执行Node语法检查、CLI帮助与参数/缺证据/损坏PNG拒绝检查，以及HTML转义/原生展开/零脚本结构检查。未用伪造截图生成成功验收包；完整654份CI artifact的实际打包、离线图片加载和逐页视觉核对由root在本轮候选结果下载后执行。详细命令和结果在交接消息中给集成人；本说明不把计划检查记作CI通过。

官方微信编译、微信开发者工具、真机和用户视觉签收均未由本工具执行，始终明确待验。不改业务代码、API、数据库、费用、支付、推送或长期档案；没有Migration、生产操作、push/merge或Library上传。

下一位AI：在包含本轮catalog/197 fixtures/21原稿的整合仓库中执行上述CLI，传入实际候选CI run/source/artifact，核对manifest、目录与所有分段图，再交付用户填写CSV签收。

2026-10-25 UTC 分段修复检查点：基于 `bbb08f364119618c1d8ffe6316dbd168cbdb7378`，只修改原脚本及本说明；旧native-full移除。新增sidecar顺序/缺段/错误偏移/文件名/端点负向检查，语法与格式检查；真实新CI `40156690255` / source `486d5d9` 的654份artifact实际打包与图像复核仍由root执行，不借用旧图作为新成功证据。


root已用最终CI40156690255 /source486d5d9真实artifact12585381105完成打包：654JSON、460PNG、21原稿、113滚动位置记录，所有目录链接与文件SHA核验通过。无native-full图；用户/官方微信验收待定。
