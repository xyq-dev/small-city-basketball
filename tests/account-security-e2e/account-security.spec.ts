import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SessionData } from '@small-city-basketball/contracts';
import pg from 'pg';
import { issueInitializationLink } from '../../apps/api/src/first-run-setup.js';

const origin = 'https://127.0.0.1:4473';
const setupFailure = '初始化未完成：链接已失效、入口未开启或实例已初始化。请联系部署人员核对。';

function isolatedDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^scb_test_[A-Za-z0-9_]+$/.test(name) ||
      name.length > 63 ||
      url.search ||
      url.hash ||
      process.env.NODE_ENV === 'production'
    )
      throw new Error();
    return url.href;
  } catch {
    throw new Error('Account-security scenario requires an isolated loopback database');
  }
}

async function openSetup(page: Page, link: string) {
  const token = new URL(link).hash.slice(1);
  // The URL passed to Playwright contains no token. Only the page's memory sees
  // the fragment, then the real SetupPage consumes it during a normal reload.
  await page.goto(`${origin}/setup`);
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate((fragment) => {
      window.history.replaceState(window.history.state, '', `/setup#${fragment}`);
      window.location.reload();
    }, token),
  ]);
  await expect(page.getByRole('button', { name: '完成首次设置', exact: true })).toBeVisible();
  expect(new URL(page.url()).hash === '').toBe(true);
}

async function fillSetup(page: Page, email: string, password: string) {
  await page.getByLabel('机构名称', { exact: true }).fill('合成账号安全验收机构');
  await page.getByLabel('管理员邮箱', { exact: true }).fill(email);
  await page.getByLabel('显示名称', { exact: true }).fill('合成初始化负责人');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
}

async function submitSetup(page: Page, expectedStatus: number) {
  const response = page.waitForResponse(
    (value) =>
      value.url() === `${origin}/v1/setup/initialize` && value.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '完成首次设置', exact: true }).click();
  expect((await response).status()).toBe(expectedStatus);
}

async function login(page: Page, email: string, password: string, expectedStatus = 200) {
  await page.goto(origin);
  await page.getByLabel('邮箱或用户名', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (value) => value.url() === `${origin}/v1/auth/login` && value.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '登录工作台', exact: true }).click();
  expect((await response).status()).toBe(expectedStatus);
  if (expectedStatus === 200)
    await expect(page.getByRole('button', { name: '个人 ID / 邀请', exact: true })).toBeVisible();
  else await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
}

async function session(page: Page): Promise<SessionData> {
  const response = await page.request.get(`${origin}/v1/auth/session`);
  expect(response.status()).toBe(200);
  return (await response.json()).data as SessionData;
}

test('首次初始化链接与本人改密通过真实 HTTPS 页面和数据库完成闭环', async ({
  page,
  browser,
}, testInfo) => {
  const pool = new pg.Pool({ connectionString: isolatedDatabase(), max: 1 });
  let secondContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let phase = 'fresh database';
  const progress = (value: string) => {
    phase = value;
    console.log(`[account-security:${testInfo.project.name}] ${value}`);
  };
  const secrets: string[] = [];
  let leakedRequest = false;
  let browserErrors = 0;
  let passwordPosts = 0;
  const observe = (target: Page) => {
    target.on('pageerror', () => browserErrors++);
    target.on('request', (request) => {
      const visible = `${request.url()}\n${request.headers()['referer'] ?? ''}`;
      if (secrets.some((secret) => visible.includes(secret))) leakedRequest = true;
      if (request.url() === `${origin}/v1/auth/change-password` && request.method() === 'POST')
        passwordPosts++;
    });
  };
  observe(page);
  const suffix = randomBytes(10).toString('hex');
  const email = `security-browser-${suffix}@example.test`;
  const oldPassword = randomBytes(24).toString('base64url');
  const newPassword = randomBytes(24).toString('base64url');
  const invalidPassword = randomBytes(24).toString('base64url');
  secrets.push(oldPassword, newPassword, invalidPassword);
  const issue = async () => {
    const result = await issueInitializationLink(pool, { enabled: true, appOrigin: origin });
    secrets.push(new URLSearchParams(new URL(result.link).hash.slice(1)).get('token')!);
    return result.link;
  };
  const identity = async () =>
    (
      await pool.query(
        'SELECT id,email,login_name,display_name,status,email_verified_at FROM users ORDER BY id',
      )
    ).rows;
  const empty = async () => {
    const result = await pool.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT initialized_at IS NULL FROM first_run_setup WHERE singleton=true) AS uninitialized`);
    expect(result.rows[0]).toEqual({ users: 0, organizations: 0, uninitialized: true });
  };
  try {
    await empty();
    progress('missing link rejected');
    await page.goto(`${origin}/setup`);
    await expect(page.getByRole('alert')).toContainText('请通过部署人员提供的有效初始化链接');
    await expect(page.getByRole('button', { name: '完成首次设置', exact: true })).toHaveCount(0);

    progress('expired link rejected');
    const expiredLink = await issue();
    await pool.query(
      "UPDATE first_run_setup SET token_expires_at=clock_timestamp()-interval '1 second' WHERE singleton=true",
    );
    await openSetup(page, expiredLink);
    await fillSetup(page, email, oldPassword);
    await submitSetup(page, 403);
    await expect(page.getByRole('alert')).toHaveText(setupFailure);
    await empty();

    progress('rotated link rejected');
    const replacedLink = await issue();
    const validLink = await issue();
    await openSetup(page, replacedLink);
    await fillSetup(page, email, oldPassword);
    await submitSetup(page, 403);
    await expect(page.getByRole('alert')).toHaveText(setupFailure);
    await empty();

    progress('owner created through form');
    await openSetup(page, validLink);
    await fillSetup(page, email, oldPassword);
    await page.getByLabel('确认密码', { exact: true }).fill(invalidPassword);
    await page.getByRole('button', { name: '完成首次设置', exact: true }).click();
    await expect(page.getByText('两次输入的密码不一致', { exact: true })).toBeVisible();
    await empty();
    await page.getByLabel('确认密码', { exact: true }).fill(oldPassword);
    await submitSetup(page, 200);
    await expect(page.getByRole('heading', { name: '初始化完成', exact: true })).toBeVisible();
    await expect(page.getByLabel('密码', { exact: true })).toHaveCount(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(1);
    const initialIdentity = await identity();
    expect(initialIdentity[0].login_name).toBeNull();
    expect(initialIdentity[0].email_verified_at).toBeNull();

    progress('used link and reissuance rejected');
    await openSetup(page, validLink);
    await fillSetup(page, email, oldPassword);
    await submitSetup(page, 403);
    await expect(page.getByRole('alert')).toHaveText(setupFailure);
    let issuanceRejected = false;
    try {
      await issueInitializationLink(pool, { enabled: true, appOrigin: origin });
    } catch (error) {
      issuanceRejected = (error as { code?: string }).code === 'SETUP_CLOSED';
    }
    expect(issuanceRejected).toBe(true);

    progress('two independent browser sessions logged in');
    await login(page, email, oldPassword);
    const originalSession = await session(page);
    expect(originalSession.organizations).toHaveLength(1);
    expect(originalSession.organizations[0]!.role).toBe('ORG_OWNER');
    expect(Boolean(originalSession.platformOperator)).toBe(false);
    const originalCookie = (await page.context().cookies(origin)).find(
      (cookie) => cookie.name === 'scb.sid',
    );
    expect(Boolean(originalCookie?.secure && originalCookie.httpOnly)).toBe(true);
    secondContext = await browser.newContext({
      viewport: page.viewportSize(),
      isMobile: Boolean(testInfo.project.use.isMobile),
      hasTouch: Boolean(testInfo.project.use.hasTouch),
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      ignoreHTTPSErrors: true,
    });
    const second = await secondContext.newPage();
    observe(second);
    await login(second, email, oldPassword);
    expect(await session(second)).toEqual(originalSession);

    progress('incorrect current password leaves sessions intact');
    await page.getByRole('button', { name: '个人 ID / 邀请', exact: true }).click();
    await page.getByLabel('当前密码', { exact: true }).fill(invalidPassword);
    await page.getByLabel('新密码', { exact: true }).fill(newPassword);
    await page.getByLabel('确认新密码', { exact: true }).fill(newPassword);
    const badChange = page.waitForResponse(
      (response) => response.url() === `${origin}/v1/auth/change-password`,
    );
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
    expect((await badChange).status()).toBe(422);
    await expect(page.getByRole('alert')).toContainText('当前密码不正确');
    expect(await session(page)).toEqual(originalSession);
    expect(await session(second)).toEqual(originalSession);
    expect(
      (await pool.query('SELECT credential_reset_at IS NULL AS unchanged FROM users')).rows[0]
        .unchanged,
    ).toBe(true);

    progress('mismatched confirmation makes no request');
    await page.getByLabel('当前密码', { exact: true }).fill(oldPassword);
    await page.getByLabel('确认新密码', { exact: true }).fill(invalidPassword);
    const postsBeforeMismatch = passwordPosts;
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
    await expect(page.getByText('两次输入的新密码不一致', { exact: true })).toBeVisible();
    expect(passwordPosts).toBe(postsBeforeMismatch);
    expect(await session(page)).toEqual(originalSession);

    progress('password change accepted by real API');
    await page.getByLabel('确认新密码', { exact: true }).fill(newPassword);
    const changed = page.waitForResponse(
      (response) => response.url() === `${origin}/v1/auth/change-password`,
    );
    await page.getByRole('button', { name: '修改密码并重新登录', exact: true }).click();
    expect((await changed).status()).toBe(200);
    progress('password change success notice and login form visible');
    // Registration capabilities can be loading concurrently in a second status.
    // Match the exact success notice instead of assuming one status on the page.
    await expect(
      page.getByRole('status').filter({ hasText: '密码已修改，所有旧会话已退出，请重新登录。' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '登录工作台', exact: true })).toBeVisible();
    // Replay the old current-session cookie explicitly. A cleared cookie alone
    // would not prove that the server revoked that session.
    progress('old current-session cookie replay rejected');
    const currentRevoked = await page.request.get(`${origin}/v1/auth/session`, {
      headers: { Cookie: `scb.sid=${originalCookie!.value}` },
    });
    expect(currentRevoked.status()).toBe(401);
    progress('second browser session rejected');
    expect((await second.request.get(`${origin}/v1/auth/session`)).status()).toBe(401);
    progress('second browser reload returns to login');
    await second.reload();
    await expect(second.getByRole('button', { name: '登录工作台', exact: true })).toBeVisible();
    progress('database confirms all old sessions revoked and identity intact');
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NULL'))
        .rows[0].count,
    ).toBe(0);
    expect(await identity()).toEqual(initialIdentity);

    progress('old password rejected and new password accepted');
    await login(page, email, oldPassword, 401);
    await login(page, email, newPassword);
    expect(await session(page)).toEqual(originalSession);
    expect(await identity()).toEqual(initialIdentity);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM audit_logs WHERE action='AUTH_PASSWORD_CHANGED'",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(leakedRequest).toBe(false);
    expect(browserErrors).toBe(0);
    progress('complete: identity preserved, no URL or referrer leakage');
  } catch {
    // A raw Playwright call log can contain form values or fragment URLs. Never
    // rethrow it, attach it, or capture page state in this credential scenario.
    throw new Error(`Account-security browser acceptance failed during: ${phase}`);
  } finally {
    // Remove the credential form before fixture teardown as a second defense.
    await page.close().catch(() => {});
    await secondContext?.close();
    await pool.end();
  }
});
