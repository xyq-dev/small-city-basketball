import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SessionData } from '@small-city-basketball/contracts';

const origin = 'http://127.0.0.1:4273';

async function chooseOrganization(page: Page, id: string) {
  const selector = page.getByLabel('切换机构', { exact: true });
  if (!(await selector.isVisible()))
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await selector.selectOption(id);
  const close = page.getByRole('button', { name: '关闭导航', exact: true });
  if (await close.isVisible()) await close.click();
}

test('注册、持久草稿、重新登录和机构切换使用真实API与数据库', async ({
  page,
  playwright,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const email = `browser-${suffix}@example.test`;
  const password = `Browser-test-${suffix}`;
  const eventName = `持久赛事-${suffix}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByRole('button', { name: '首次使用？创建机构账号' }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('称呼', { exact: true }).fill('浏览器验证员');
  await page.getByLabel('机构名称', { exact: true }).fill(`机构一-${suffix}`);
  await page.getByRole('button', { name: '创建账号并进入', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: /欢迎回来/ })).toBeVisible();
  const sid = (await page.context().cookies()).find((cookie) => cookie.name === 'scb.sid');
  expect(sid?.httpOnly).toBe(true);
  expect(['Lax', 'Strict']).toContain(sid?.sameSite);

  await page.goto('/events/new');
  await page.getByLabel('赛事名称').fill(eventName);
  await page.getByLabel('开始日期').fill('2026-12-01');
  await page.getByLabel('结束日期').fill('2026-12-05');
  await page.getByLabel('比赛地点').fill('合成测试球场');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: eventName, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: eventName, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑草稿', exact: true }).click();
  await page.getByLabel('赛事名称').fill(`${eventName}·修订`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: `${eventName}·修订`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('v2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回到你的主场', exact: true })).toBeVisible();
  expect(
    (await page.context().cookies()).find((cookie) => cookie.name === 'scb.sid'),
  ).toBeUndefined();
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作台', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: `${eventName}·修订`, exact: true }),
  ).toBeVisible();

  const meResponse = await page.request.get('/v1/auth/session');
  expect(meResponse.status()).toBe(200);
  const me = (await meResponse.json()).data as SessionData;
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const registration = await other.post(`${origin}/v1/auth/register`, {
      headers: { Origin: origin },
      data: {
        email: `other-${suffix}@example.test`,
        password,
        displayName: '第二机构验证员',
        organizationName: `机构二-${suffix}`,
      },
    });
    expect(registration.status()).toBe(201);
    const otherSession = (await registration.json()).data as SessionData;
    const secondOrganization = otherSession.organizations[0]!;
    const membership = await other.put(
      `${origin}/v1/orgs/${secondOrganization.id}/members/${me.user.id}`,
      {
        headers: { Origin: origin },
        data: { role: 'ORG_ADMIN', status: 'ACTIVE' },
      },
    );
    expect(membership.ok()).toBe(true);
    await page.goto('/events');
    await chooseOrganization(page, me.organizations[0]!.id);
    await expect(page.getByRole('link', { name: `${eventName}·修订`, exact: true })).toBeVisible();
    await chooseOrganization(page, secondOrganization.id);
    await expect(page.getByRole('link', { name: `${eventName}·修订`, exact: true })).toHaveCount(0);
    const secondList = await page.request.get(`/v1/orgs/${secondOrganization.id}/events`);
    expect(secondList.status()).toBe(200);
    expect((await secondList.json()).data).toEqual([]);
    await chooseOrganization(page, me.organizations[0]!.id);
    await expect(page.getByRole('link', { name: `${eventName}·修订`, exact: true })).toBeVisible();
  } finally {
    await other.dispose().catch(() => console.error('[persistence] API context cleanup failed'));
  }

  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('API连接失败明确报错，不出现演示工作台', async ({ page }) => {
  await page.route('**/v1/auth/session', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: '测试服务暂不可用',
          requestId: 'browser-unavailable',
        },
      }),
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '暂时无法连接工作台', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('测试服务暂不可用');
  await expect(
    page.getByText('请恢复连接后重试，当前未载入赛事数据。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /欢迎回来/ })).toHaveCount(0);
});
