import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function fillDraft(page: Page, name: string) {
  await page.getByLabel('赛事名称').fill(name);
  await page.getByLabel('开始日期').fill('2026-11-12');
  await page.getByLabel('结束日期').fill('2026-11-19');
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.width);
}

test('创建、编辑与组合筛选使用同一份演示赛事数据', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /欢迎回来/ })).toBeVisible();
  await expect(page.getByLabel('赛事概览')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });

  await page.getByRole('link', { name: '创建一届赛事' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '创建赛事' })).toBeVisible();
  await fillDraft(page, '社区友谊篮球赛');
  await page.getByLabel('比赛地点').fill('城市体育馆');
  await page.getByRole('radio', { name: /分组后淘汰/ }).check();
  await page.screenshot({ path: testInfo.outputPath('create-event.png'), fullPage: true });
  await page.getByRole('button', { name: '保存草稿' }).click();

  await expect(page.getByRole('heading', { level: 1, name: '社区友谊篮球赛' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('赛事草稿已创建');
  await expect(page.getByRole('button', { name: '编辑草稿' })).toBeVisible();
  await page.getByRole('button', { name: '编辑草稿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '编辑赛事' })).toBeVisible();
  await page.getByLabel('赛事名称').fill('社区友谊篮球赛·修订版');
  await page.getByLabel('比赛地点').fill('石鼓训练馆');
  await page.getByRole('button', { name: '保存修改' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: '社区友谊篮球赛·修订版' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('修改已保存');
  await expect(page.getByText('v2', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('event-detail.png'), fullPage: true });
  await page.getByRole('link', { name: '返回赛事列表' }).click();

  await page.getByRole('textbox', { name: '搜索赛事' }).fill('社区友谊');
  await page.getByLabel('赛事状态').selectOption('DRAFT');
  await expect(
    page.getByRole('link', { name: '社区友谊篮球赛·修订版', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('共 1 届赛事', { exact: false })).toBeVisible();
  await page.getByLabel('赛事状态').selectOption('RUNNING');
  await expect(page.getByRole('heading', { name: '没有找到符合条件的赛事' })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: '搜索赛事' })).toHaveValue('');
  await expect(page.getByLabel('赛事状态')).toHaveValue('ALL');
  await expect(
    page.getByRole('link', { name: '社区友谊篮球赛·修订版', exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('表单错误保留输入，空地点以待定显示', async ({ page }) => {
  await page.goto('/events/new');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('请输入赛事名称', { exact: true })).toBeVisible();
  await expect(page.getByLabel('赛事名称')).toBeFocused();

  await fillDraft(page, '日期校验赛事');
  await page.getByLabel('结束日期').fill('2026-11-01');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('结束日期不能早于开始日期', { exact: true })).toBeVisible();
  await expect(page.getByLabel('赛事名称')).toHaveValue('日期校验赛事');
  await expect(page.getByLabel('开始日期')).toHaveValue('2026-11-12');
  await expect(page.getByLabel('结束日期')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('结束日期').fill('2026-11-19');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '日期校验赛事' })).toBeVisible();
  await expect(page.getByText('待定', { exact: true })).toBeVisible();
});

test('取消创建与取消编辑均不保存未提交输入', async ({ page }) => {
  await page.goto('/events/new');
  await fillDraft(page, '不应被创建的赛事');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page).toHaveURL('/events');
  await expect(page.getByRole('link', { name: '不应被创建的赛事', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: '青锋杯篮球邀请赛', exact: true }).click();
  await page.getByRole('button', { name: '编辑草稿' }).click();
  await page.getByLabel('赛事名称').fill('不应被保存的修改');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '青锋杯篮球邀请赛' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '不应被保存的修改', exact: true })).toHaveCount(0);
});

test('刷新会重置内存数据，失效详情给出恢复入口', async ({ page }) => {
  await page.goto('/events/new');
  await expect(
    page.getByText('本次演示数据保存在内存中，刷新页面后重置。', { exact: false }).first(),
  ).toBeVisible();
  await fillDraft(page, '仅本次演示有效的赛事');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '仅本次演示有效的赛事' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '没有找到这届赛事' })).toBeVisible();
  await page.getByRole('link', { name: '查看赛事列表', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '赛事管理', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '仅本次演示有效的赛事', exact: true })).toHaveCount(
    0,
  );
});

test('不存在的赛事不能展示其他赛事资料', async ({ page }) => {
  await page.goto('/events/event-does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: '没有找到这届赛事' })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑草稿' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: '2026 秋季城市联赛' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '查看赛事列表', exact: true })).toBeVisible();
});

test('导航在窄屏可操作且关键页面无水平溢出', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByLabel('赛事概览')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'mobile') {
    const open = page.getByRole('button', { name: '打开导航', exact: true });
    await open.click();
    await expect(page.getByRole('dialog', { name: '机构工作台导航' })).toBeVisible();
    await expect(page.getByRole('button', { name: '关闭导航', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(open).toBeFocused();
    await open.click();
    await page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('link', { name: '赛事管理', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: '机构工作台导航' })).toHaveCount(0);
  } else {
    await page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('link', { name: '赛事管理', exact: true })
      .click();
  }

  await expect(
    page.getByRole('heading', { level: 1, name: '赛事管理', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '青锋杯篮球邀请赛', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('link', { name: '创建赛事', exact: true }).click();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop') {
    await page.setViewportSize({ width: 1024, height: 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('create-event-tablet.png'), fullPage: true });
  }
});
