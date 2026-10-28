# 已合并分支清理记录

2026-10-29 Asia/Shanghai。用户明确要求“已经通过测试的先删除”；Codex 为集成人，独立审查负责链接与归档边界复核。

## 核验与结果

- 清理前 main：`2503107de292c3d43e545a1a70b047b546125391`。34 个目标 HEAD 均经 GitHub Compare 核验，`ahead_by=0` 且 merge base 等于目标 HEAD；开放 PR 为 0。删除前再次读取分支列表，目标 HEAD 均未变化。
- main 的 [Application checks 40724292830](https://github.com/xyq-dev/small-city-basketball/actions/runs/40724292830) 已完成，admin、api、production 三项全部 SUCCESS；执行提交为 `26220b8fa3c12f6a198e6e38e416041326d49bc6`。其后的 main 仅有交接 Markdown，业务代码相同。此前候选完整验证与逐步合并 tree 证据见 [C19 交接](../handoffs/C19.md)。
- GitHub 插件未提供删除分支接口，Git HTTPS 命令通道没有写入凭据；通过已有授权网页会话逐项删除。每项均显示 Deleted，刷新后列表仅剩以下 4 个保留分支；随后 GitHub API 再次核对，34 个目标消失，main 和三条证据分支的 SHA 均未改变。
- 仓库 1441 个跟踪文件未发现指向待删分支的 blob/tree/raw 链接。PR #22 的 3 处和 #28 的 5 处分支链接已改为固定 `a384896228bba35e665da22178b23a02eaf5c2bb`；目标文件存在。证据分支链接保持不变。
- 只删除远端分支引用，没有删除 main 中的提交、PR 历史、证据文件或用户本地分支。没有代码、Migration、生产环境、权限或凭据变更，没有 force push。

## 保留分支

| 分支 | 清理后 HEAD | 原因 |
| --- | --- | --- |
| `evidence/c09-mini-ui-fidelity` | `61836a187c6e8d6ae628e71158d91cf62dcdfeda` | 尚有独立历史证据，保留归档 |
| `evidence/c10-mini-ui-complete` | `1484cd708b2fc8cbcdc251e47b47d3ef86639bba` | 尚有独立历史证据，保留归档 |
| `evidence/c13-wechat-native-ui` | `11836d8b2707bb3a759c1efdb9f1fd659495bbd5` | 尚有独立历史证据，保留归档 |
| `main` | `2503107de292c3d43e545a1a70b047b546125391` | 默认主分支 |

## 已删除分支与恢复依据

这些提交均仍可由 main 的祖先历史到达。若以后确有需要，可从对应 SHA 重新创建同名分支；恢复前应核对名称是否已被新工作使用。

| 已删除分支 | 删除前 HEAD |
| --- | --- |
| `c19/follows` | `86feedd6040c0b178b64acc0c36cf7d8cdd98bc8` |
| `c19/media` | `f9690848b93d9a76d485c7539cd6fe25f55e81cd` |
| `c19/seasons` | `2be4b86b340ebb7cfcfcc24541c5ab8cacdd74d9` |
| `c19/teams` | `041b1c4caf35cc0adcebff0cf0e8b0623e881ba0` |
| `c19/verify` | `152a0f23c075533fea5a7ceed725aad1d569d580` |
| `docs/c10-visual-acceptance` | `1e02915ac01dca4ca3301f7d42ebed4d0d05b5af` |
| `docs/c11-ui-acceptance` | `33afcdeaf8629872e68edfc4ef053afced80a5b4` |
| `docs/c12-native-ui-handoff` | `768699b98b79d0649afcc9599bde5dc4cb70cd92` |
| `feat/C02-commercial-core` | `ec74c47120a913973c3fbb27fc105d52e0203114` |
| `feat/C03-event-history` | `71451d65ae73604690057a0232e486f42796c1ac` |
| `feat/C04-single-elimination` | `bc6516dc0068812c8075f9a88effa89c4183190f` |
| `feat/C05-commercial-completion` | `9abeb5c8aeaf294c1df75320d0c7bf4592fc1d23` |
| `feat/P01-organizer-console` | `819818d2f9fcee972f4c2e7854800dc6ad2415bf` |
| `feat/P02-foundation` | `63b94beee51d51b02f4bade7f36baba92edceb11` |
| `feat/P03-registration` | `c2d96b2f2b3801bedcb7e73258b48f5d05c88a83` |
| `feat/P04-rescheduling` | `cc10b3d54e3a8c86cf94c4c1e7cff014534b6a98` |
| `feat/P04-scheduling` | `7336bfa01a6a3b6afb08dd2c90260f8497b1239e` |
| `feat/P05-basic-scoring` | `1cb8e41400de4e497580e98c7eb77d6a7a02e079` |
| `feat/P05-standings-public` | `d9161e965b367ed8cb445482d57759bd34e89629` |
| `feat/P06-overlay` | `addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11` |
| `feat/P07-production` | `8809d67a568b86d3ef530ec92785877c29fab80a` |
| `feat/c12-wechat-native-acceptance` | `d74b30b45769b7ecfc1cc8e499174dbd031e661a` |
| `feat/mini-program-complete` | `8441c019824744b39c387cc5c0b58bdf18ea2d88` |
| `feat/mini-program-completion` | `a384896228bba35e665da22178b23a02eaf5c2bb` |
| `feat/mini-program-confirmation-safety` | `a3d39ad45b252b82e193d1183d429e56f6e3df4c` |
| `feat/mini-program-delivery` | `48a2408fd7dd75d778c2b47a5cd2d9a4e84a2218` |
| `feat/mini-program-native-management` | `806180cc8de731921e29f06a5ca46a75808673c6` |
| `feat/mini-program-platform-alignment` | `015b8ad1c15852a99e531442a721ba6e4c118b0d` |
| `feat/mini-program-ui` | `96aa0af6192202b2b381c58f718c6dd10c69cbab` |
| `feat/mini-ui-approved-match` | `1d038743907d7357fb5035e1853520e20037ecf6` |
| `feat/player-reservations` | `1722333d50c077cbf11efc388381c68440873dfe` |
| `feat/public-event-directory` | `5d5ecc442979f3d2949cee44062f4b2088b06561` |
| `fix/mini-ui-fidelity` | `486d5d9cf1befc06be64b955e60288bd9c38b9f3` |
| `fix/wechat-wxml-logical-operators` | `a4d61a512a22f97aed8d1dc289d188b8d6bacdf8` |

本记录及 C19 状态文档为清理后的文档提交，未重新执行应用测试；本轮无业务或测试代码变化。官方微信及真机验收仍待办。
