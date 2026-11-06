# UI006 Coverage Matrix

Updated: 2026-11-06. This matrix is newly counted for UI006 and does not inherit UI005 completion claims.

## Evidence semantics

- Native UI implementation: 73/73 registered routes use the rebuilt WXML/WXSS component system.
- Isolated layout evidence: 73/73 routes and 17/17 host-route states render at measured 320, 390, and 430 logical px with no horizontal overflow. This is synthetic compatibility-renderer evidence, not WeChat runtime proof or automatic pixel-perfect sign-off.
- Function wiring: route-level gates verify registered routes, native templates, existing handlers, state branches, permissions, pending-result recovery, and fixture business assertions. The final full-suite result is recorded in README.md.
- WeChat runtime: only home and account were captured from the current source at logical 390x844. The SDK PNGs are 360x779 and are not relabeled as 390x844 files. A final clean DevTools restart then required account re-login, so the current matrix was not recaptured as WeChat screenshots.
- Production writes: none. Synthetic fixture data is confined to isolated previews and tests.

External full evidence:

- `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\final-isolated-routes`
- `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\final-isolated-states`
- `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\isolated-priority-final2`
- `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\wechat-runtime-current`

Representative repository evidence and exact validation limits are linked from [README.md](README.md).

## Registered routes (73)

| Route | Figma node | Implementation | Native UI | Isolated 320/390/430 | Function wiring | WeChat runtime |
| --- | --- | --- | --- | --- | --- | --- |
| `pages/home/index` | [35:38](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=35-38) | `apps/wechat/pages/home/index.{wxml,wxss,js}` | complete | pass | connected + route gate | real state, logical 390x844 |
| `pages/watch/index` | [36:53](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-53) | `apps/wechat/pages/watch/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/local/index` | [36:54](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-54) | `apps/wechat/pages/local/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/teams/index` | [36:55](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-55) | `apps/wechat/pages/teams/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/account/index` | [36:56](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-56) | `apps/wechat/pages/account/index.{wxml,wxss,js}` | complete | pass | connected + route gate | real state, logical 390x844 |
| `pages/city-select/index` | [36:57](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-57) | `apps/wechat/pages/city-select/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/search/index` | [36:58](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-58) | `apps/wechat/pages/search/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/media/index` | [36:59](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-59) | `apps/wechat/pages/media/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/event/index` | [36:60](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-60) | `apps/wechat/pages/event/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/match/index` | [36:61](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-61) | `apps/wechat/pages/match/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/public-archives/index` | [36:63](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-63) | `apps/wechat/pages/public-archives/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/public-archive/index` | [36:64](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-64) | `apps/wechat/pages/public-archive/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/follows/index` | [36:65](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-65) | `apps/wechat/pages/follows/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/recruitment/index` | [36:66](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-66) | `apps/wechat/pages/recruitment/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/poster/index` | [36:67](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-67) | `apps/wechat/pages/poster/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/team/index` | [36:68](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-68) | `apps/wechat/pages/team/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/team-request/index` | [36:69](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-69) | `apps/wechat/pages/team-request/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/team-requests/index` | [36:70](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-70) | `apps/wechat/pages/team-requests/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/team-join/index` | [36:71](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-71) | `apps/wechat/pages/team-join/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/memberships/index` | [36:72](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-72) | `apps/wechat/pages/memberships/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/invitation/index` | [36:73](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-73) | `apps/wechat/pages/invitation/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/registration-events/index` | [36:74](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-74) | `apps/wechat/pages/registration-events/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/entry/index` | [36:75](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-75) | `apps/wechat/pages/entry/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/players/index` | [36:76](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-76) | `apps/wechat/pages/players/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/player/index` | [36:77](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-77) | `apps/wechat/pages/player/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/compare/index` | [36:78](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-78) | `apps/wechat/pages/compare/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/booking-create/index` | [36:79](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-79) | `apps/wechat/pages/booking-create/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/bookings/index` | [36:80](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-80) | `apps/wechat/pages/bookings/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/booking-detail/index` | [36:81](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-81) | `apps/wechat/pages/booking-detail/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/player-center/index` | [36:82](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-82) | `apps/wechat/pages/player-center/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/performance/index` | [36:83](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-83) | `apps/wechat/pages/performance/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/local-manage/index` | [36:84](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-84) | `apps/wechat/pages/local-manage/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/local-bookings/index` | [36:85](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-85) | `apps/wechat/pages/local-bookings/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/local-matchups/index` | [36:86](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-86) | `apps/wechat/pages/local-matchups/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/matching/index` | [36:87](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-87) | `apps/wechat/pages/matching/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/dispatch/index` | [36:88](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-88) | `apps/wechat/pages/dispatch/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/training/index` | [36:89](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-89) | `apps/wechat/pages/training/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/training-manage/index` | [36:90](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-90) | `apps/wechat/pages/training-manage/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/org-event/index` | [36:92](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-92) | `apps/wechat/pages/org-event/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/event-setup/index` | [36:93](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-93) | `apps/wechat/pages/event-setup/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/staff-configuration/index` | [36:94](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-94) | `apps/wechat/pages/staff-configuration/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/entry-review/index` | [36:95](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-95) | `apps/wechat/pages/entry-review/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/schedule/index` | [36:96](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-96) | `apps/wechat/pages/schedule/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/bracket/index` | [36:97](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-97) | `apps/wechat/pages/bracket/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/reschedule/index` | [36:98](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-98) | `apps/wechat/pages/reschedule/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/seasons/index` | [36:99](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-99) | `apps/wechat/pages/seasons/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/scoring-tasks/index` | [36:100](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-100) | `apps/wechat/pages/scoring-tasks/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/org-match/index` | [36:101](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-101) | `apps/wechat/pages/org-match/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/scorer/index` | [36:102](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-102) | `apps/wechat/pages/scorer/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/match-exceptions/index` | [36:103](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-103) | `apps/wechat/pages/match-exceptions/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/season-grants/index` | [36:104](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-104) | `apps/wechat/pages/season-grants/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/match-media/index` | [36:105](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-105) | `apps/wechat/pages/match-media/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/live-studio/index` | [36:106](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-106) | `apps/wechat/pages/live-studio/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/media-jobs/index` | [36:107](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-107) | `apps/wechat/pages/media-jobs/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/participant-materials/index` | [36:108](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-108) | `apps/wechat/pages/participant-materials/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/insurance/index` | [36:109](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-109) | `apps/wechat/pages/insurance/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/qualification-precheck/index` | [36:110](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-110) | `apps/wechat/pages/qualification-precheck/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/guardian/index` | [36:111](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-111) | `apps/wechat/pages/guardian/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/youth-review/index` | [36:112](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-112) | `apps/wechat/pages/youth-review/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/planned/index` | [36:113](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-113) | `apps/wechat/pages/planned/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/account-recovery/index` | [36:117](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-117) | `apps/wechat/pages/account-recovery/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/messages/index` | [36:118](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-118) | `apps/wechat/pages/messages/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/notification-settings/index` | [36:119](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-119) | `apps/wechat/pages/notification-settings/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/account-closure/index` | [36:120](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-120) | `apps/wechat/pages/account-closure/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/governance/index` | [36:121](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-121) | `apps/wechat/pages/governance/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/governance-reviews/index` | [36:122](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-122) | `apps/wechat/pages/governance-reviews/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/platform/index` | [36:123](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-123) | `apps/wechat/pages/platform/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/sponsorships/index` | [36:124](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-124) | `apps/wechat/pages/sponsorships/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/sponsor-commerce/index` | [36:125](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-125) | `apps/wechat/pages/sponsor-commerce/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/public-ledgers/index` | [36:126](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-126) | `apps/wechat/pages/public-ledgers/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/trade-order/index` | [36:127](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-127) | `apps/wechat/pages/trade-order/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/trade-manage/index` | [36:128](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-128) | `apps/wechat/pages/trade-manage/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |
| `pages/city-operations/index` | [36:129](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-129) | `apps/wechat/pages/city-operations/index.{wxml,wxss,js}` | complete | pass | connected + route gate | not run |

## Supplemental host-route states (17)

| State | Host route | Figma node | Registration | Isolated 320/390/430 | WeChat runtime |
| --- | --- | --- | --- | --- | --- |
| `event-standings` | `pages/event/index` | [36:62](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-62) | host condition only | pass | isolated unless naturally available |
| `local-map` | `pages/local/index` | [36:91](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-91) | host condition only | pass | isolated unless naturally available |
| `materials-returned` | `pages/participant-materials/index` | [36:114](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-114) | host condition only | pass | isolated unless naturally available |
| `qualification-progress` | `pages/qualification-precheck/index` | [36:115](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-115) | host condition only | pass | isolated unless naturally available |
| `account-guest` | `pages/account/index` | [36:116](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-116) | host condition only | pass | isolated unless naturally available |
| `refund-progress` | `pages/trade-order/index` | [36:130](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-130) | host condition only | pass | isolated unless naturally available |
| `settlement-check` | `pages/sponsor-commerce/index` | [36:131](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-131) | host condition only | pass | isolated unless naturally available |
| `watch-empty` | `pages/watch/index` | [36:132](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-132) | host condition only | pass | isolated unless naturally available |
| `local-location` | `pages/local/index` | [36:133](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-133) | host condition only | pass | isolated unless naturally available |
| `account-wechat` | `pages/account/index` | [36:134](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-134) | host condition only | pass | isolated unless naturally available |
| `event-access` | `pages/event/index` | [36:135](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-135) | host condition only | pass | isolated unless naturally available |
| `reschedule-network` | `pages/reschedule/index` | [36:136](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-136) | host condition only | pass | isolated unless naturally available |
| `scorer-readonly` | `pages/scorer/index` | [36:137](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-137) | host condition only | pass | isolated unless naturally available |
| `funds-result-unknown` | `pages/trade-order/index` | [36:138](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-138) | host condition only | pass | isolated unless naturally available |
| `reschedule-changed` | `pages/reschedule/index` | [36:139](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-139) | host condition only | pass | isolated unless naturally available |
| `materials-list` | `pages/participant-materials/index` | [39:53](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=39-53) | host condition only | pass | isolated unless naturally available |
| `materials-review` | `pages/participant-materials/index` | [39:54](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=39-54) | host condition only | pass | isolated unless naturally available |
