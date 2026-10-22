import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type {
  EntryData,
  EventData,
  EventRegistrationData,
  SessionData,
  TeamData,
} from '@small-city-basketball/contracts';

const origin = 'http://127.0.0.1:4273';
async function write<T>(
  request: APIRequestContext,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
) {
  const response = await request.fetch(`${origin}${path}`, {
    method,
    headers: { Origin: origin },
    data: body,
  });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
async function read<T>(request: APIRequestContext, path: string) {
  const response = await request.get(`${origin}${path}`);
  expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}
async function confirm(page: Page, label: string, confirmation: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: confirmation, exact: true }).click();
}

test('领队邀请、关闭后的名单补交、独立审核、冻结与撤权使用真实服务', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const password = `Registration-browser-${suffix}`;
  const teamName = `报名验证队-${suffix}`;
  const eventName = `报名验证赛事-${suffix}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const owner = await write<SessionData>(page.request, 'POST', '/v1/auth/register', {
    email: `registration-owner-${suffix}@example.test`,
    password,
    displayName: '报名审核验证员',
    organizationName: `报名验证机构-${suffix}`,
  });
  const orgId = owner.organizations[0]!.id;
  const root = `/v1/orgs/${orgId}`;
  const secondContext = await browser.newContext({
    viewport: page.viewportSize(),
    isMobile: Boolean(testInfo.project.use.isMobile),
    hasTouch: Boolean(testInfo.project.use.hasTouch),
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
  });
  const leader = await secondContext.newPage();
  leader.on('pageerror', (error) => errors.push(error.message));
  const urls: string[] = [];
  leader.on('request', (request) => urls.push(request.url()));
  try {
    // A participant signs up through the real UI without becoming an organization member.
    await leader.goto(origin);
    await leader.getByRole('button', { name: '球队领队？创建个人账号', exact: true }).click();
    await expect(leader.getByRole('heading', { name: '创建领队账号', exact: true })).toBeVisible();
    await expect(leader.getByLabel('机构名称', { exact: true })).toHaveCount(0);
    await leader
      .getByLabel('邮箱', { exact: true })
      .fill(`registration-leader-${suffix}@example.test`);
    await leader.getByLabel('密码', { exact: true }).fill(password);
    await leader.getByLabel('称呼', { exact: true }).fill('合成验证领队');
    await leader.getByRole('button', { name: '创建账号并进入', exact: true }).click();
    const personalId = leader.getByLabel('我的个人 ID', { exact: true });
    await expect(personalId).toBeVisible();
    const leaderId = await personalId.inputValue();
    const initial = await read<SessionData>(leader.request, '/v1/auth/session');
    expect(initial.user.id).toBe(leaderId);
    expect(initial.organizations).toEqual([]);
    expect(initial.teamContexts).toEqual([]);

    // Staff create the team and bind the invitation to that exact personal account.
    await page.goto('/teams');
    await page.getByRole('button', { name: '创建球队', exact: true }).click();
    await page.getByLabel('球队名称', { exact: true }).fill(teamName);
    await page.getByRole('button', { name: '保存球队', exact: true }).click();
    await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}$/);
    const teamId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByLabel('受邀用户 ID', { exact: true }).fill(leaderId);
    await page.getByRole('button', { name: '生成领队邀请', exact: true }).click();
    const invitationLink = await page.getByLabel('邀请链接', { exact: true }).inputValue();
    const fragment = new URLSearchParams(new URL(invitationLink).hash.slice(1));
    const invitationId = fragment.get('invitation')!;
    const token = fragment.get('token')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await leader.goto(invitationLink);
    await expect(leader.getByRole('dialog', { name: '个人账号与球队邀请' })).toBeVisible();
    expect(new URL(leader.url()).hash).toBe('');
    await leader.getByRole('button', { name: '接受球队邀请', exact: true }).click();
    await expect(
      leader.getByText('邀请已接受，球队授权已刷新。请选择“我的球队”开始报名。', { exact: true }),
    ).toBeVisible();
    await leader.getByRole('button', { name: '关闭个人账号', exact: true }).click();
    const accepted = await read<SessionData>(leader.request, '/v1/auth/session');
    expect(accepted.organizations).toEqual([]);
    expect(accepted.teamContexts.map((context) => context.teamId)).toEqual([teamId]);

    await leader.goto(`${origin}/teams/${teamId}`);
    await leader.getByRole('button', { name: '编辑成员', exact: true }).click();
    await leader.getByRole('button', { name: '添加成员', exact: true }).click();
    await leader.getByRole('button', { name: '添加成员', exact: true }).click();
    await leader.getByLabel('成员1姓名', { exact: true }).fill('合成队员甲');
    await leader.getByLabel('成员2姓名', { exact: true }).fill('合成队员乙');
    await leader.getByRole('button', { name: '保存成员', exact: true }).click();
    await expect(leader.getByText('成员已保存', { exact: true })).toBeVisible();

    const event = await write<EventData>(page.request, 'POST', `${root}/events`, {
      name: eventName,
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      timezone: 'Asia/Shanghai',
      format: 'ROUND_ROBIN',
    });
    const registrationPath = `${root}/events/${event.id}`;
    await page.goto(`/events/${event.id}/registration`);
    await expect(page.getByRole('link', { name: '报名审核', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: '赛事管理', exact: true })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByLabel('最少参赛人数', { exact: true }).fill('2');
    await page.getByLabel('最多参赛人数', { exact: true }).fill('3');
    await page.getByLabel('0 与 00 为不同球衣号码', { exact: false }).check();
    await page.getByRole('button', { name: '保存报名规则', exact: true }).click();
    await expect(page.getByText('报名规则已保存', { exact: true })).toBeVisible();
    await confirm(page, '开放报名', '确认开放');
    await expect(page.getByText('报名已开放，当前规则已锁定', { exact: true })).toBeVisible();

    await leader.goto(`${origin}/my-team`);
    await leader.getByRole('button', { name: '报名此赛事', exact: true }).click();
    await expect(leader).toHaveURL(/\/entries\/[0-9a-f-]{36}$/);
    const entryId = new URL(leader.url()).pathname.split('/').at(-1)!;
    const entryPath = `${root}/entries/${entryId}`;
    await leader.getByRole('checkbox', { name: /^选择合成队员甲（成员\d+）$/ }).check();
    await leader.getByRole('checkbox', { name: /^选择合成队员乙（成员\d+）$/ }).check();
    await leader.getByRole('textbox', { name: /^球衣号码（合成队员甲，成员\d+）$/ }).fill('0');
    await leader.getByRole('textbox', { name: /^球衣号码（合成队员乙，成员\d+）$/ }).fill('00');
    await leader.getByRole('button', { name: '保存名单', exact: true }).click();
    await expect(leader.getByText('新名单版本已保存', { exact: true })).toBeVisible();
    await confirm(leader, '提交报名', '确认提交报名');
    await expect(leader.getByText('报名已提交，等待独立审核', { exact: true })).toBeVisible();
    await expect(leader.getByRole('button', { name: '审核通过', exact: true })).toHaveCount(0);
    await expect(leader.getByRole('button', { name: '保存名单', exact: true })).toHaveCount(0);

    // Create a second approved team plus one unsubmitted entry before closing.
    async function fixture(label: string, approved: boolean) {
      let team = await write<TeamData>(page.request, 'POST', `${root}/teams`, {
        name: `${label}-${suffix}`,
      });
      team = await write<TeamData>(page.request, 'PUT', `${root}/teams/${team.id}/members`, {
        expectedVersion: team.version,
        members: [{ name: '合成球员丙' }, { name: '合成球员丁' }],
      });
      await write(page.request, 'PUT', `${root}/teams/${team.id}/grants/${leaderId}`, {
        status: 'ACTIVE',
      });
      let entry = await write<EntryData>(leader.request, 'POST', `${registrationPath}/entries`, {
        teamId: team.id,
      });
      if (approved) {
        entry = await write<EntryData>(
          leader.request,
          'PUT',
          `${root}/entries/${entry.id}/roster`,
          {
            expectedVersion: entry.version,
            players: team.members.map((member, index) => ({
              memberId: member.id,
              jerseyNo: String(index + 1),
            })),
          },
        );
        entry = await write<EntryData>(
          leader.request,
          'POST',
          `${root}/entries/${entry.id}/commands`,
          { type: 'SUBMIT', expectedVersion: entry.version },
        );
        await write(page.request, 'POST', `${root}/entries/${entry.id}/commands`, {
          type: 'APPROVE',
          expectedVersion: entry.version,
        });
      }
    }
    await fixture('第二批准队', true);
    await fixture('未提交排除队', false);
    await page.goto(`/entries/${entryId}`);
    await page.getByRole('button', { name: '退回修改', exact: true }).click();
    await page.getByLabel('审核原因', { exact: true }).fill('请核对甲的本届球衣号码');
    await page.getByRole('button', { name: '确认退回修改', exact: true }).click();
    await expect(page.getByText('报名已退回修改', { exact: true })).toBeVisible();
    await page.goto(`/events/${event.id}/registration`);
    await confirm(page, '关闭报名', '确认关闭');
    await expect(page.getByText('报名已关闭', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '冻结参赛名单', exact: true })).toHaveCount(0);

    // Closed registration still permits this explicitly requested correction.
    await leader.reload();
    await expect(leader.getByText('待修改', { exact: true })).toBeVisible();
    await leader.getByRole('textbox', { name: /^球衣号码（合成队员甲，成员\d+）$/ }).fill('8');
    await expect(leader.getByRole('button', { name: '提交报名', exact: true })).toBeDisabled();
    await leader.getByRole('button', { name: '保存名单', exact: true }).click();
    await expect(leader.getByText('新名单版本已保存', { exact: true })).toBeVisible();
    await expect(leader.getByText('待修改', { exact: true })).toBeVisible();
    await confirm(leader, '提交报名', '确认提交报名');
    await expect(leader.getByText('报名已提交，等待独立审核', { exact: true })).toBeVisible();
    await page.goto(`/entries/${entryId}`);
    await confirm(page, '审核通过', '确认审核通过');
    await expect(page.getByText('报名已审核通过', { exact: true })).toBeVisible();
    await page.goto(`/events/${event.id}/registration`);
    await confirm(page, '冻结参赛名单', '确认冻结');
    await expect(page.getByRole('heading', { name: '冻结快照', exact: true })).toBeVisible();
    const frozen = await read<EventRegistrationData>(
      page.request,
      `${registrationPath}/registration`,
    );
    expect(frozen.freeze?.entries).toHaveLength(2);
    expect(frozen.freeze?.excludedCounts).toEqual({ DRAFT: 1, REJECTED: 0, WITHDRAWN: 0 });
    expect(
      frozen.freeze?.entries
        .find((entry) => entry.entryId === entryId)
        ?.players.find((player) => player.name === '合成队员甲')?.jerseyNo,
    ).toBe('8');
    await page.reload();
    await expect(page.getByRole('heading', { name: '冻结快照', exact: true })).toBeVisible();

    await leader.goto(`${origin}/teams/${teamId}`);
    await leader.getByRole('button', { name: '编辑成员', exact: true }).click();
    await leader.getByLabel('成员1姓名', { exact: true }).fill('长期成员后续更名');
    await leader.getByRole('button', { name: '保存成员', exact: true }).click();
    await expect(leader.getByText('成员已保存', { exact: true })).toBeVisible();
    const retained = await read<EventRegistrationData>(
      page.request,
      `${registrationPath}/registration`,
    );
    expect(retained.freeze).toEqual(frozen.freeze);
    await leader.goto(`${origin}/entries/${entryId}`);
    await expect(leader.getByRole('button', { name: '保存名单', exact: true })).toHaveCount(0);
    await expect(leader.getByRole('button', { name: '撤回报名', exact: true })).toHaveCount(0);

    await page.goto(`/teams/${teamId}`);
    await confirm(page, '停用领队', '确认停用');
    await expect(page.getByText('领队授权已更新', { exact: true })).toBeVisible();
    await leader.reload();
    await expect(leader.getByRole('heading', { name: '暂时无法读取', exact: true })).toBeVisible();
    expect((await leader.request.get(`${origin}${entryPath}`)).status()).toBe(404);
    const replay = await leader.request.post(`${origin}/v1/invitations/${invitationId}/accept`, {
      headers: { Origin: origin },
      data: { token },
    });
    expect(replay.status()).toBe(409);
    expect((await leader.request.get(`${origin}${entryPath}`)).status()).toBe(404);
    expect(urls.some((url) => url.includes(token))).toBe(false);
    for (const current of [page, leader]) {
      expect(await current.evaluate(() => Object.keys(localStorage))).toEqual([]);
      expect(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(
      (await secondContext.cookies()).find((cookie) => cookie.name === 'scb.sid')?.httpOnly,
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await secondContext.close();
  }
});
