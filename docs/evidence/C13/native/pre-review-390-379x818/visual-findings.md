# C13 official WeChat DevTools capture (2026-10-26)

Copy: artifacts/wechat-ui/2026-10-26T07-16-23-939Z/project, runId 8dc017c3-5ccb-4895-a519-fbfec940ef12,
sourceHead a4d61a5 + uncommitted C13 changes (sourceDirty true). AppID only in this copy.
DevTools base library 3.17.4, simulator iPhone 12/13 (Pro) 390x844 logical, dpr 3.
Raw PNGs are 379x818 as returned by the SDK; not resized.
Synthetic fixtures with business lifecycle disabled: compile and layout evidence only.

## Captured (15 + 1 scrolled)
C11: home, player market, player detail, compare, booking create, booking orders.
Platform: home events, home signed-out, events list, events no-org, org-event schedule,
standings, groups, stats, unavailable; plus platform-home-events-scrolled.png (extension section).

## Fixed and re-captured this round
1. booking-create player card and summary rows collapsed: style v2 default button width 184px.
2. compare grid overflow: column header buttons forced to 184px wider than each column.
3. player detail back arrow centred: header back button got 184px plus auto margins.
4. bookings detail buttons half width: same cause.
5. Bottom bar unified to the icon variant on all tabs.
6. No-org main action promoted to a primary button; home booking entries given card fill.

## Compile blockers found and fixed
- A semicolon inside a comment in components/header/index.wxss: AppService never started.
- Selector ".org-match-teams > .org-match-vs" in pages/org-event/index.wxss: same symptom.
  Rewritten as "text.org-match-vs". Both isolated by bisecting a disposable copy.

## Remaining observations
- WeChat shows its own home button at top left on non-first pages opened by reLaunch.
- Stats header "名单场次" is tight at 390 width.
- 320 and 430 widths not captured officially: the automator cannot switch the simulator model.
