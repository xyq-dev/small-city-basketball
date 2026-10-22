import { expect, test } from '@playwright/test';
import {
  httpsOrigin,
  noOverflow,
  ownerInput,
  productionFixture,
  requireCheck,
  stage,
} from './support.js';

const origin = httpsOrigin();

test('private deep link, login and registration capabilities', async ({ page, context }) => {
  const owner = await ownerInput();
  const fixture = await productionFixture();
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  await stage('private-deep-login-and-caps', async () => {
    await page.goto(`/events/${fixture.event.id}`);
    await expect(
      page.getByRole('heading', { name: '欢迎回到你的主场', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '球队领队？创建个人账号', exact: true }),
    ).toBeVisible();
    requireCheck(
      (await page.getByRole('button', { name: '首次使用？创建机构账号', exact: true }).count()) ===
        0,
      'closed-organization-ui',
    );
    await page.getByRole('button', { name: '球队领队？创建个人账号', exact: true }).click();
    await expect(page.getByRole('heading', { name: '创建领队账号', exact: true })).toBeVisible();
    requireCheck(
      (await page.getByLabel('机构名称', { exact: true }).count()) === 0,
      'participant-has-no-organization',
    );
    await page.getByRole('button', { name: '已有账号？返回登录', exact: true }).click();
    await page.getByLabel('邮箱', { exact: true }).fill(owner.email);
    await page.getByLabel('密码', { exact: true }).fill(owner.password);
    const login = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/v1/auth/login' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '登录工作台', exact: true }).click();
    requireCheck((await login).status() === 200, 'browser-real-login');
    await expect(
      page.getByRole('heading', { name: fixture.event.name, exact: true }),
    ).toBeVisible();
    requireCheck(
      new URL(page.url()).pathname === `/events/${fixture.event.id}`,
      'private-deep-path-preserved',
    );
    const cookies = await context.cookies(origin);
    const session = cookies.find((item) => item.name === 'scb.sid');
    requireCheck(
      session?.secure && session.httpOnly && session.sameSite === 'Lax' && session.path === '/',
      'browser-private-cookie',
    );
    requireCheck(await noOverflow(page), 'private-mobile-width');
    requireCheck(pageErrors === 0, 'private-runtime-errors');
  });
});

test('anonymous watch and overlay are independent and transparent', async ({ page, context }) => {
  const fixture = await productionFixture();
  const active = fixture.overlays.active.find((item) => item.snapshot.score !== null)!;
  let privateRequests = 0;
  let bootstrapRequests = 0;
  let bootstrapFragmentCleared = true;
  let secretInRequestUrl = false;
  let pageErrors = 0;
  page.on('pageerror', () => pageErrors++);
  context.on('request', (request) => {
    if (request.url().includes(active.token)) secretInRequestUrl = true;
    const path = new URL(request.url()).pathname;
    if (/^\/v1\/(auth|orgs|invitations)(\/|$)/.test(path)) privateRequests++;
    if (path.endsWith('/bootstrap')) {
      bootstrapRequests++;
      if (new URL(page.url()).hash !== '') bootstrapFragmentCleared = false;
    }
  });
  await stage('anonymous-public-deep-link', async () => {
    await page.goto(`/watch/${fixture.viewing.publicId}`);
    await expect(
      page.getByRole('heading', { name: fixture.viewing.overview.name, exact: true }),
    ).toBeVisible();
    requireCheck(await noOverflow(page), 'watch-mobile-width');
    const match = fixture.viewing.matches[0]!;
    await page.goto(`/watch/${fixture.viewing.publicId}/matches/${match.publicMatchId}`);
    await expect(
      page.getByRole('heading', {
        name: `${match.home.teamName} vs ${match.away.teamName}`,
        exact: true,
      }),
    ).toBeVisible();
    requireCheck(await noOverflow(page), 'watch-match-mobile-width');
    await page.goto(`/watch/${fixture.viewing.revokedId}`);
    await expect(page.getByRole('heading', { name: '观赛链接不可用', exact: true })).toBeVisible();
    requireCheck(privateRequests === 0, 'watch-has-no-private-initialization');
  });
  await stage('overlay-fragment-cookie-and-reload', async () => {
    // Source is always a 1920x1080 composition, including when the management
    // browser is mobile. The preceding watch pages used the real mobile viewport.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/overlay/${active.overlayId}?scene=production#token=${active.token}`);
    await expect(page.getByLabel('包装主队比分', { exact: true })).toHaveText(
      String(active.snapshot.score!.home),
    );
    requireCheck(
      new URL(page.url()).hash === '' && new URL(page.url()).search === '?scene=production',
      'source-fragment-cleared',
    );
    requireCheck(
      bootstrapRequests >= 1 &&
        privateRequests === 0 &&
        bootstrapFragmentCleared &&
        !secretInRequestUrl,
      'source-is-independent',
    );
    const cookies = await context.cookies(`${origin}/v1/overlays/${active.overlayId}/snapshot`);
    const cookie = cookies.find((item) => item.name === 'scb.overlay');
    requireCheck(
      cookie?.secure &&
        cookie.httpOnly &&
        cookie.sameSite === 'Strict' &&
        cookie.path === `/v1/overlays/${active.overlayId}/`,
      'source-cookie-policy',
    );
    requireCheck(
      !cookies.some((item) => item.name === 'scb.sid'),
      'anonymous-has-no-private-session',
    );
    const bootstraps = bootstrapRequests;
    await page.reload();
    await expect(page.getByLabel('包装客队比分', { exact: true })).toHaveText(
      String(active.snapshot.score!.away),
    );
    requireCheck(
      bootstrapRequests === bootstraps && privateRequests === 0,
      'cookie-only-source-reload',
    );
    requireCheck(
      await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0),
      'no-browser-credential-storage',
    );
  });
  await stage('source-transparent-pixels', async () => {
    // Inspect a memory-only screenshot. It is never written or attached.
    const png = await page.screenshot({ omitBackground: true });
    const pixels = await page.evaluate(async (encoded) => {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const drawing = canvas.getContext('2d')!;
      drawing.drawImage(image, 0, 0);
      // Device scale can differ between desktop and mobile projects.
      const scale = image.width / window.innerWidth;
      return [
        drawing.getImageData(0, 0, 1, 1).data[3],
        drawing.getImageData(Math.round(960 * scale), Math.round(900 * scale), 1, 1).data[3],
      ];
    }, png.toString('base64'));
    requireCheck(pixels[0] === 0 && pixels[1]! > 0, 'transparent-outside-visible-scorebar');
    requireCheck(await noOverflow(page), 'source-canvas-width');
    requireCheck(
      pageErrors === 0 && privateRequests === 0,
      'anonymous-runtime-and-request-boundary',
    );
  });
});
