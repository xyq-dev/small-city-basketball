import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function expectNoPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(size.document).toBeLessThanOrEqual(size.viewport + 1);
  expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
}

test('同价同位置球员按含费估算和有限样本对比，详情保留真实零与未统计', async ({ page }) => {
  await page.goto('/players');
  await expect(page.getByRole('heading', { name: /球员广场/ })).toBeVisible();
  await expect(page.getByText('交互演示', { exact: true })).toBeVisible();

  const market = page.locator('#player-market');
  const first = market.getByRole('article', { name: '陈宇航 球员资料', exact: true });
  await first.getByRole('button', { name: '找同价同位置', exact: true }).click();
  await expect(page.getByLabel('参赛费同价筛选')).toHaveValue('30000');
  await expect(page.getByRole('button', { name: '控球后卫', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(market.getByRole('article')).toHaveCount(2);
  const second = market.getByRole('article', { name: '林泽宇 球员资料', exact: true });
  await expect(first.getByText('统计 5 场', { exact: true })).toBeVisible();
  await expect(second.getByText('统计 3 场', { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await first.getByRole('button', { name: '加入对比 陈宇航', exact: true }).click();
  await second.getByRole('button', { name: '加入对比 林泽宇', exact: true }).click();
  await page.getByRole('link', { name: '开始对比', exact: true }).click();
  await expect(page).toHaveURL(/\/players\/compare\?ids=/);
  await expect(
    page.getByRole('heading', { name: '同价，也要看记录与适配', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/不同样本数不可直接当成能力排名/)).toBeVisible();

  const region = page.getByRole('region', { name: '球员并排对比数据', exact: true });
  const table = region.getByRole('table');
  const feeRow = table.getByRole('row', { name: /^参赛服务报价/ });
  await expect(feeRow.getByRole('cell').nth(0)).toContainText(/[¥￥]\s*300/);
  await expect(feeRow.getByRole('cell').nth(1)).toContainText(/[¥￥]\s*300/);

  const estimate = table.getByRole('row', { name: /^预计合计（含平台与交通食宿）/ });
  await expect(estimate.getByRole('cell').nth(0)).toContainText(/[¥￥]\s*330/);
  await expect(estimate.getByRole('cell').nth(1)).toContainText(/[¥￥]\s*410/);
  const samples = table.getByRole('row', { name: /^个人统计场次/ });
  await expect(samples.getByRole('cell').nth(0)).toHaveText('5场');
  await expect(samples.getByRole('cell').nth(1)).toHaveText('3场');
  const completeness = table.getByRole('row', { name: /^数据完整度/ });
  await expect(completeness.getByRole('cell').nth(0)).toContainText('已有个人记录');
  await expect(completeness.getByRole('cell').nth(1)).toContainText('部分个人记录');
  const absentMetrics = table.getByRole('row', { name: /^其他表现指标/ });
  for (const cell of await absentMetrics.getByRole('cell').all()) {
    await expect(cell).toContainText('助攻、篮板、上场时间、投篮命中率：均未统计');
  }
  // The comparison table may scroll inside its own region on a phone. It must
  // not make either the body or the document wider than the viewport.
  await estimate.getByRole('cell').nth(1).scrollIntoViewIfNeeded();
  await expect(estimate.getByRole('cell').nth(1)).toBeVisible();
  await expectNoPageOverflow(page);

  await table.getByRole('link', { name: '陈宇航', exact: true }).click();
  await expect(page).toHaveURL('/players/demo-guard');
  await expect(page.getByRole('heading', { name: '陈宇航', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已授权比赛记录', exact: true })).toBeVisible();
  await expect(
    page.getByText('合成统计演示，用于展示功能，不是真实球员表现。', { exact: true }),
  ).toBeVisible();
  const recent = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: '来源口径', exact: true }),
  });
  await expect(recent.locator('tbody tr')).toHaveCount(5);
  await expect(recent.locator('tbody tr').nth(1).getByRole('cell').nth(2)).toHaveText('0');
  await expect(page.getByText('助攻：未统计', { exact: true })).toBeVisible();
  await expect(page.getByText('篮板：未统计', { exact: true })).toBeVisible();
  await expect(page.getByText('完成服务记录 · 非付费成交', { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
});
