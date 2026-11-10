import { test, expect, devices } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import type {
  SessionData,
  SoftwareMembershipWorkspaceData,
  SoftwareMembershipPlanData,
  EventStandingsData,
  CourtData,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import {
  origin,
  read,
  write,
  syntheticIdentities,
  registration,
} from '../api-e2e/helpers/commercial-fixtures.js';

const why = '隔离会员浏览器验收，无真实资金';
const platform = '/v1/platform/software-membership';
const path = (orgId: string) => `/v1/orgs/${orgId}/software-membership`;
async function operatorFixture(identities: Awaited<ReturnType<typeof syntheticIdentities>>) {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(database.pathname.slice(1))) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Membership identities require an owned loopback test database');
  // This official maintenance entry point is ESM with a guarded top-level await.
  // Load this checkout's compiled module natively, after the target guard;
  // Playwright's CommonJS test transform must not rewrite its import.meta.
  const { maintainPlatformOperator } = (await import(
    pathToFileURL(resolve('apps/api/dist/commerce/platform-operator.js')).href
  )) as typeof import('../../apps/api/src/commerce/platform-operator.js');
  const pool = new pg.Pool({ connectionString: database.href, max: 1 });
  try {
    for (const user of identities.users.slice(1))
      await maintainPlatformOperator(pool, { email: user.email, status: 'ACTIVE', reason: why });
  } finally {
    await pool.end();
  }
}
async function confirmDialog(page: Page, name: string, reference?: string) {
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('操作原因', { exact: true }).fill(why);
  if (reference) await dialog.getByLabel('实际线下交易引用', { exact: true }).fill(reference);
  await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('机构会员真实报价、独立付款复核、首次发布扣额与用量在桌面手机可操作', async ({
  page,
  browser,
}, info) => {
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const progress = (name: string) => console.log(`[membership:${info.project.name}] ${name}`);
  try {
    const identities = await syntheticIdentities();
    await operatorFixture(identities);
    await write<SessionData>(page.request, 'POST', '/v1/auth/login', {
      email: identities.users[1]!.email,
      password: identities.password,
    });
    await page.goto('/platform/membership');
    await expect(
      page.getByRole('heading', { level: 1, name: '平台会员运营', exact: true }),
    ).toBeVisible();
    progress('operator loads a local suggestion before explicit immutable plan publication');
    const before = await read<SoftwareMembershipWorkspaceData>(page.request, platform);
    await page
      .getByRole('combobox', { name: '建议会员模板', exact: true })
      .selectOption('scb_pro_month');
    await page.getByRole('button', { name: '载入会员建议', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '确认覆盖本地会员草稿', exact: true });
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await read<SoftwareMembershipWorkspaceData>(page.request, platform)).plans).toEqual(
      before.plans,
    );
    const suffix = randomUUID().slice(0, 8);
    const planName = `合成专业机构月费-${suffix}`;
    const planCode = `ci_member_${suffix}`;
    await page.getByLabel('套餐代码', { exact: true }).fill(planCode);
    await page.getByLabel('套餐名称', { exact: true }).fill(planName);
    await page.getByLabel('发布原因', { exact: true }).fill(why);
    await expect(page.getByLabel('价格（元）', { exact: true })).toHaveValue('199');
    await page.getByRole('button', { name: '核对并发布会员套餐', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '发布不可变会员套餐', exact: true });
    await expect(dialog).toBeVisible();
    expect(
      (await read<SoftwareMembershipWorkspaceData>(page.request, platform)).plans.some(
        (p) => p.code === planCode,
      ),
    ).toBe(false);
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const published = await read<SoftwareMembershipWorkspaceData>(page.request, platform);
    const monthly = published.plans.find((p) => p.code === planCode)!;
    expect(monthly).toMatchObject({
      amountFen: 19900,
      tier: 'PRO',
      durationDays: 30,
      eventLimit: 3,
      maxTeams: 16,
      maxMatches: 128,
    });
    // The remaining display fixtures are published through the same real operator API.
    for (const [code, name, tier, durationDays, amountFen] of [
      ['pro_year', '小城市·专业机构年费', 'PRO', 365, 169900],
      ['business_month', '小城市·商业机构月费', 'BUSINESS', 30, 39900],
      ['business_year', '小城市·商业机构年费', 'BUSINESS', 365, 339900],
    ] as const)
      await write<{ plan: SoftwareMembershipPlanData }>(page.request, 'POST', `${platform}/plans`, {
        commandId: randomUUID(),
        code: `ci_${code}_${suffix}`,
        name,
        currency: 'CNY',
        amountFen,
        tier,
        durationDays,
        reason: why,
      });

    const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13']!;
    for (let index = 1; index <= 2; index++) {
      const context = await browser.newContext({
        ...(info.project.name === 'mobile-api'
          ? phone
          : { viewport: { width: 1440, height: 1040 } }),
        baseURL: origin,
      });
      contexts.push(context);
      await write(context.request, 'POST', '/v1/auth/login', {
        email: identities.users[index]!.email,
        password: identities.password,
      });
    }
    await write(page.request, 'POST', '/v1/auth/login', {
      email: identities.users[0]!.email,
      password: identities.password,
    });
    await page.goto('/membership');
    await expect(
      page.getByRole('heading', { level: 1, name: '会员与权益', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '小城市·专业机构年费', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '小城市·商业机构年费', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir('artifacts/member02', { recursive: true });
    await page.screenshot({
      path: `artifacts/member02/${info.project.name}-plans.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '月付', exact: true }).click();
    const card = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: planName, exact: true }) });
    await card.getByRole('button', { name: '核对购买专业机构会员', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '会员订单核对', exact: true });
    await expect(dialog.getByRole('button', { name: '确认操作', exact: true })).toBeDisabled();
    await dialog
      .getByRole('checkbox', { name: '我已核对付费机构、金额、购买期和额度', exact: true })
      .check();
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    let owner = await read<SoftwareMembershipWorkspaceData>(page.request, path(identities.orgId));
    expect(owner.orders).toHaveLength(1);
    expect(owner.periods).toHaveLength(0);
    const pending = owner.orders[0]!;
    expect(pending).toMatchObject({
      eventId: null,
      status: 'PENDING_PAYMENT',
      quote: { planId: monthly.id, amountFen: 19900, eventLimit: 3 },
    });
    progress('two actual independent operator accounts verify the original manual receipt');
    const operatorPage = await contexts[0]!.newPage();
    await operatorPage.goto('/platform/membership');
    await operatorPage.getByRole('tab', { name: '会员订单', exact: true }).click();
    let orderCard = operatorPage.getByRole('article', { name: `${planName}会员订单`, exact: true });
    await orderCard.getByRole('button', { name: '提交线下收款核验', exact: true }).click();
    await confirmDialog(operatorPage, '提交线下收款核验', `ci-member-browser-${randomUUID()}`);
    await expect(
      orderCard.getByRole('button', { name: '独立确认线下到账', exact: true }),
    ).toHaveCount(0);
    const reviewerPage = await contexts[1]!.newPage();
    await reviewerPage.goto('/platform/membership');
    await reviewerPage.getByRole('tab', { name: '会员订单', exact: true }).click();
    orderCard = reviewerPage.getByRole('article', { name: `${planName}会员订单`, exact: true });
    await orderCard.getByRole('button', { name: '独立确认线下到账', exact: true }).click();
    await confirmDialog(reviewerPage, '独立确认线下到账');
    owner = await read<SoftwareMembershipWorkspaceData>(page.request, path(identities.orgId));
    expect(owner.orders[0]!.status).toBe('PAID');
    expect(owner.periods[0]).toMatchObject({ state: 'ACTIVE', usedEvents: 0, remainingEvents: 3 });
    expect(owner.orders[0]!.paymentReview?.submittedByUserId).not.toBe(
      owner.orders[0]!.paymentReview?.reviewedByUserId,
    );

    const fixture = await registration(
      page.request,
      contexts[0]!.request,
      identities.orgId,
      identities.users[1]!.id,
      'ROUND_ROBIN',
      2,
    );
    const court = await write<CourtData>(page.request, 'POST', `${fixture.root}/courts`, {
      name: '会员真实浏览器球场',
    });
    let standing = await write<EventStandingsData>(
      page.request,
      'PUT',
      `${fixture.eventPath}/standings-rules`,
      {
        expectedEventVersion: fixture.registration.event.version,
        winPoints: 2,
        lossPoints: 1,
        drawPoints: 0,
        tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR', 'WINS'],
      },
    );
    standing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${fixture.eventPath}/standings-rule-commands`,
      {
        type: 'PUBLISH_STANDINGS_RULES',
        expectedEventVersion: standing.event.version,
        rulesetId: standing.rules!.id,
      },
    );
    let revision = await write<ScheduleRevisionData>(
      page.request,
      'POST',
      `${fixture.eventPath}/schedule-revisions`,
      {
        expectedEventVersion: standing.event.version,
        freezeId: fixture.registration.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 30,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2026-12-01T01:00:00.000Z',
              endsAt: '2026-12-01T03:00:00.000Z',
            },
          ],
        },
      },
    );
    revision = await write<ScheduleRevisionData>(
      page.request,
      'PUT',
      `${fixture.root}/schedule-revisions/${revision.id}/allocations`,
      {
        expectedEventVersion: revision.eventVersion,
        expectedRevisionVersion: revision.version,
        allocations: revision.fixtures.map((f) => ({
          fixtureKey: f.fixtureKey,
          courtId: court.id,
          startsAt: '2026-12-01T01:00:00.000Z',
        })),
      },
    );
    expect(
      (await read<SoftwareMembershipWorkspaceData>(page.request, path(identities.orgId)))
        .periods[0]!.usedEvents,
    ).toBe(0);
    progress('original browser schedule confirmation consumes one whole-event quota atomically');
    await page.goto(`/events/${fixture.eventId}/scheduling`);
    await page.getByRole('button', { name: '检查赛程冲突', exact: true }).click();
    await expect(page.getByText('当前版本检查通过', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '发布正式赛程', exact: true }).click();
    const confirmation = page.getByRole('region', { name: '正式发布确认', exact: true });
    await expect(confirmation).toContainText('消耗本机构会员1届额度');
    await confirmation.getByRole('button', { name: '确认发布正式赛程', exact: true }).click();
    await expect(page.getByRole('heading', { name: '正式赛程', exact: true })).toBeVisible();
    owner = await read<SoftwareMembershipWorkspaceData>(page.request, path(identities.orgId));
    expect(owner.periods[0]).toMatchObject({ usedEvents: 1, remainingEvents: 2 });
    expect(owner.allocations).toEqual([
      expect.objectContaining({
        eventId: fixture.eventId,
        periodId: owner.periods[0]!.id,
        source: 'MEMBERSHIP',
      }),
    ]);
    expect(owner.orders[0]!.activated).toBe(true);
    await page.goto('/membership');
    await page.getByRole('tab', { name: '购买期与用量', exact: true }).click();
    const periodCard = page.getByRole('article', { name: `${planName}购买期`, exact: true });
    await expect(periodCard).toContainText('生效中');
    await expect(periodCard).toContainText('2 / 3 届可用');
    await expect(periodCard).toContainText('1届，来自服务端全期统计');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/member02/${info.project.name}-usage.png`,
      fullPage: true,
    });
    await page.reload();
    await page.getByRole('tab', { name: '购买期与用量', exact: true }).click();
    await expect(
      page.getByRole('article', { name: `${planName}购买期`, exact: true }),
    ).toContainText('2 / 3 届可用');
    const oldWorkspace = await read<{ orders: unknown[]; events: { id: string }[] }>(
      page.request,
      `/v1/orgs/${identities.orgId}/commerce`,
    );
    expect(oldWorkspace.orders).toEqual([]);
    expect(oldWorkspace.events.some((event) => event.id === fixture.eventId)).toBe(false);
    expect(errors).toEqual([]);
    progress('complete: paid period, original activation ledger and refresh retain the same quota');
  } finally {
    for (const context of contexts) await context.close();
  }
});
