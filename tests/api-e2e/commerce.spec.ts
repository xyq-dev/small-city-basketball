import { expect, test, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type {
  CommerceWorkspaceData,
  EventData,
  SessionData,
  WechatCapabilitiesData,
} from '@small-city-basketball/contracts';
import { origin, read, write, syntheticIdentities } from './helpers/commercial-fixtures.js';

/** Test-only role fixture. This never runs without the original isolated DB guard. */
async function platformFixtures(actorId: string, users: string[]) {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(database.pathname.slice(1))) ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Platform browser identities require an explicitly isolated test database');
  const pool = new pg.Pool({ connectionString: database.href, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const id of users)
      await c.query(
        "INSERT INTO platform_operators(user_id,status,maintenance_actor_id,reason) VALUES($1,'ACTIVE',$2,$3)",
        [id, actorId, '合成浏览器身份夹具，不是生产授权'],
      );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
}

test('独立平台账号套餐运营、关闭计费及未配置微信状态使用真实浏览器', async ({
  page,
  browser,
  playwright,
}, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  let secondContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let buyerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let phase = 'strictly isolated users and explicit test platform-role seed';
  const progress = (value: string) => {
    phase = value;
    console.log(`[commerce:${testInfo.project.name}] ${value}`);
  };
  try {
    const identities = await syntheticIdentities();
    await platformFixtures(identities.users[0]!.id, [
      identities.users[1]!.id,
      identities.users[2]!.id,
    ]);
    const first = await write<SessionData>(page.request, 'POST', '/v1/auth/login', {
      email: identities.users[1]!.email,
      password: identities.password,
    });
    expect(first.organizations).toHaveLength(0);
    expect(first.teamContexts).toHaveLength(0);
    const operatorWorkspace = await read<CommerceWorkspaceData>(
      page.request,
      '/v1/platform/commerce',
    );
    expect(operatorWorkspace.platformOperator).toBe(true);
    expect(operatorWorkspace.orgId).toBeNull();
    expect(operatorWorkspace.mode).toBe('OFF');
    expect(operatorWorkspace.realPaymentEnabled).toBe(false);
    expect((await anonymous.get(origin + '/v1/platform/commerce')).status()).toBe(401);
    progress(
      'an actual platform operator with no organization opens the independent platform route',
    );
    await page.goto('/platform/commerce');
    await expect(
      page.getByRole('heading', { level: 1, name: '平台商业运营', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: '创建套餐新版本', exact: true })).toBeVisible();
    const suffix = randomUUID().slice(0, 8);
    const code = `browser_${suffix}`;
    const name = `合成浏览器套餐-${suffix}`;
    await page.getByLabel('套餐代码', { exact: true }).fill(code);
    await page.getByLabel('套餐名称', { exact: true }).fill(name);
    await page.getByLabel('价格（元）', { exact: true }).fill('123.45');
    await page.getByLabel('最多球队', { exact: true }).fill('4');
    await page.getByLabel('最多比赛', { exact: true }).fill('5');
    await page.getByLabel('激活有效天数', { exact: true }).fill('30');
    await page.getByLabel('发布原因', { exact: true }).fill('隔离浏览器核对不可变人民币报价');
    await page.getByRole('button', { name: '核对并发布套餐版本', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '发布不可变套餐版本', exact: true });
    await expect(dialog).toBeVisible();
    expect(
      (await read<CommerceWorkspaceData>(page.request, '/v1/platform/commerce')).plans.some(
        (p) => p.code === code,
      ),
    ).toBe(false);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(
      (await read<CommerceWorkspaceData>(page.request, '/v1/platform/commerce')).plans.some(
        (p) => p.code === code,
      ),
    ).toBe(false);
    await page.getByRole('button', { name: '核对并发布套餐版本', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '发布不可变套餐版本', exact: true });
    await dialog.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: `${name} v1`, exact: true })).toBeVisible();
    const plan = (
      await read<CommerceWorkspaceData>(page.request, '/v1/platform/commerce')
    ).plans.find((p) => p.code === code)!;
    expect(plan).toMatchObject({
      version: 1,
      amountFen: 12345,
      currency: 'CNY',
      maxTeams: 4,
      maxMatches: 5,
      validDays: 30,
      available: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    progress(
      'another independent no-organization operator sees the same immutable version and explicitly changes availability',
    );
    secondContext = await browser.newContext({
      ...(testInfo.project.name === 'mobile-api'
        ? devices['iPhone 13']
        : devices['Desktop Chrome']),
      viewport: page.viewportSize()!,
      baseURL: origin,
    });
    const second = await secondContext.newPage();
    second.on('pageerror', (error) => errors.push(error.message));
    const secondSession = await write<SessionData>(second.request, 'POST', '/v1/auth/login', {
      email: identities.users[2]!.email,
      password: identities.password,
    });
    expect(secondSession.organizations).toHaveLength(0);
    await second.goto('/platform/commerce');
    const planCard = second
      .getByRole('article')
      .filter({ has: second.getByRole('heading', { name: `${name} v1`, exact: true }) });
    await expect(planCard).toBeVisible();
    await planCard.getByRole('button', { name: '停售此版本', exact: true }).click();
    const availability = second.getByRole('dialog', { name: '确认套餐上下架', exact: true });
    await availability.getByLabel('操作原因', { exact: true }).fill('独立操作员核对后停售合成版本');
    await availability.getByRole('button', { name: '确认操作', exact: true }).click();
    await expect(availability).toHaveCount(0);
    await expect(planCard).toContainText('已停售；原报价保留');
    const retained = (
      await read<CommerceWorkspaceData>(second.request, '/v1/platform/commerce')
    ).plans.find((p) => p.id === plan.id)!;
    expect(retained.amountFen).toBe(12345);
    expect(retained.version).toBe(1);
    expect(retained.catalogVersion).toBe(plan.catalogVersion + 1);
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    progress(
      'organization ownership alone cannot reach platform billing; OFF mode cannot create a payable order',
    );
    buyerContext = await browser.newContext({
      ...(testInfo.project.name === 'mobile-api'
        ? devices['iPhone 13']
        : devices['Desktop Chrome']),
      viewport: page.viewportSize()!,
      baseURL: origin,
    });
    const buyer = await buyerContext.newPage();
    buyer.on('pageerror', (error) => errors.push(error.message));
    await write<SessionData>(buyer.request, 'POST', '/v1/auth/login', {
      email: identities.users[0]!.email,
      password: identities.password,
    });
    expect((await buyer.request.get(origin + '/v1/platform/commerce')).status()).toBe(403);
    const event = await write<EventData>(
      buyer.request,
      'POST',
      `/v1/orgs/${identities.orgId}/events`,
      {
        name: `未收费的合成赛事-${suffix}`,
        format: 'ROUND_ROBIN',
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        timezone: 'Asia/Shanghai',
      },
    );
    const workspace = await read<CommerceWorkspaceData>(
      buyer.request,
      `/v1/orgs/${identities.orgId}/commerce`,
    );
    expect(workspace).toMatchObject({
      mode: 'OFF',
      canPurchase: false,
      realPaymentEnabled: false,
      platformOperator: false,
    });
    const blocked = await buyer.request.post(
      origin + `/v1/orgs/${identities.orgId}/commerce/orders`,
      {
        headers: { Origin: origin },
        data: {
          commandId: randomUUID(),
          eventId: event.id,
          planId: plan.id,
          expectedEventVersion: event.version,
        },
      },
    );
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe('COMMERCE_DISABLED');
    await buyer.goto('/commerce');
    await expect(
      buyer.getByRole('heading', { level: 1, name: '套餐与订单', exact: true }),
    ).toBeVisible();
    await expect(buyer.getByText(/当前未启用收费权益限制/)).toBeVisible();
    await expect(buyer.getByRole('button', { name: '核对本届订单', exact: true })).toHaveCount(0);
    await expect(buyer.getByRole('button', { name: '微信付款', exact: true })).toHaveCount(0);
    await expect(buyer.getByRole('img', { name: '微信付款二维码', exact: true })).toHaveCount(0);
    expect(
      (await read<CommerceWorkspaceData>(buyer.request, `/v1/orgs/${identities.orgId}/commerce`))
        .orders,
    ).toHaveLength(0);
    expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    progress(
      'the real account page reports unconfigured WeChat without presenting fake login or binding success',
    );
    const wechat = await read<WechatCapabilitiesData>(anonymous, '/v1/auth/wechat/capabilities');
    expect(wechat).toMatchObject({
      enabled: false,
      canLogin: false,
      canBind: false,
      canRegister: false,
    });
    await buyer.goto('/account/wechat');
    await expect(
      buyer.getByRole('heading', { level: 1, name: '微信账号绑定', exact: true }),
    ).toBeVisible();
    await expect(buyer.getByText(/微信登录尚未配置启用/)).toBeVisible();
    await expect(buyer.getByRole('button', { name: '微信登录', exact: true })).toHaveCount(0);
    expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } catch (error) {
    throw new Error(`Commerce browser check failed during: ${phase}`, { cause: error });
  } finally {
    await buyerContext?.close();
    await secondContext?.close();
    await anonymous.dispose();
  }
});
