import { expect, test, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import type {
  CourtData,
  EntryFilesData,
  EventScoringData,
  EventStandingsData,
  MatchMediaWorkspaceData,
  MediaFileData,
  PublicMatchMediaData,
  PublicScheduleMatchData,
  ScheduleRevisionData,
  ScheduledMatchData,
  SessionData,
} from '@small-city-basketball/contracts';
import { syntheticMp4, syntheticPdf, syntheticPng } from '../../apps/api/test/media-fixtures.js';
import {
  origin,
  read,
  write,
  registration,
  scoreAndConfirm,
  syntheticIdentities,
} from './helpers/commercial-fixtures.js';
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('私有PDF与真实短视频上传、片段定位及媒体撤销使用真实API和浏览器', async ({
  page,
  playwright,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const leader = await playwright.request.newContext({ baseURL: origin });
  const scorer = await playwright.request.newContext({ baseURL: origin });
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  let publicContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let phase = 'strictly isolated synthetic identities and real HTTP login';
  const progress = (value: string) => {
    phase = value;
    console.log(`[media:${testInfo.project.name}] ${value}`);
  };
  try {
    const identities = await syntheticIdentities();
    for (const [i, actor] of [page.request, leader, scorer].entries()) {
      const session = await write<SessionData>(actor, 'POST', '/v1/auth/login', {
        email: identities.users[i]!.email,
        password: identities.password,
      });
      expect(session.user.id).toBe(identities.users[i]!.id);
    }
    const fixture = await registration(
      page.request,
      leader,
      identities.orgId,
      identities.users[1]!.id,
      'ROUND_ROBIN',
      2,
    );
    const { root, eventPath, eventId } = fixture;
    const entryId = fixture.registration.freeze!.entries[0]!.entryId;
    const entryFilesPath = `${root}/entries/${entryId}/media-files`;
    const scorerId = identities.users[2]!.id;
    await write(page.request, 'PUT', `${root}/members/${scorerId}`, {
      role: 'SCORER',
      status: 'ACTIVE',
    });
    let viewing = await write<EventStandingsData>(
      page.request,
      'PUT',
      `${eventPath}/standings-rules`,
      {
        expectedEventVersion: fixture.registration.event.version,
        winPoints: 2,
        lossPoints: 1,
        drawPoints: 0,
        tiebreakers: ['SCORE_DIFFERENCE'],
      },
    );
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/standings-rule-commands`,
      {
        type: 'PUBLISH_STANDINGS_RULES',
        expectedEventVersion: viewing.event.version,
        rulesetId: viewing.rules!.id,
      },
    );
    const court = await write<CourtData>(page.request, 'POST', `${root}/courts`, {
      name: '媒体浏览器合成球场',
    });
    let revision = await write<ScheduleRevisionData>(
      page.request,
      'POST',
      `${eventPath}/schedule-revisions`,
      {
        expectedEventVersion: viewing.event.version,
        freezeId: fixture.registration.freeze!.id,
        algorithmVersion: 'RR_CIRCLE_V1',
        policy: {
          slotDurationMinutes: 60,
          minRestMinutes: 0,
          minLocalDayGap: 0,
          courtWindows: [
            {
              courtId: court.id,
              startsAt: '2026-12-01T01:00:00.000Z',
              endsAt: '2026-12-01T09:00:00.000Z',
            },
          ],
        },
      },
    );
    const revisionPath = `${root}/schedule-revisions/${revision.id}`;
    revision = await write<ScheduleRevisionData>(
      page.request,
      'PUT',
      `${revisionPath}/allocations`,
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
    await write(page.request, 'POST', `${revisionPath}/publish`, {
      expectedEventVersion: revision.eventVersion,
      expectedRevisionVersion: revision.version,
    });
    let scoring = await read<EventScoringData>(page.request, `${eventPath}/scoring`);
    scoring = await write<EventScoringData>(page.request, 'PUT', `${eventPath}/scoring-rules`, {
      expectedEventVersion: scoring.event.version,
      regulationPeriods: 1,
      periodDurationSeconds: 60,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'OVERTIME',
      overtimeDurationSeconds: 60,
    });
    expect(scoring.rules?.tiePolicy).toBe('OVERTIME');
    const match = (await read<ScheduledMatchData[]>(page.request, `${eventPath}/matches`))[0]!;
    await scoreAndConfirm(page.request, scorer, root, match.id, scorerId);
    progress(
      'real browser uploads a synthetic private PDF without changing eligibility or insurance validation',
    );
    await page.goto(`/entries/${entryId}`);
    await page.getByRole('button', { name: '管理报名私有文件', exact: true }).click();
    const entryPanel = page.getByRole('region', { name: '报名私有文件', exact: true });
    await expect(entryPanel).toBeVisible();
    await entryPanel.getByLabel('文件用途', { exact: true }).selectOption('PRIVATE_INSURANCE');
    await entryPanel.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: 'synthetic-policy.pdf',
      mimeType: 'application/pdf',
      buffer: syntheticPdf,
    });
    await entryPanel.getByRole('button', { name: '上传并保存文件', exact: true }).click();
    await expect(entryPanel.getByLabel('已保存文件')).toContainText('synthetic-policy.pdf');
    const entryFiles = await read<EntryFilesData>(page.request, entryFilesPath);
    const insurance = entryFiles.files.find((f) => f.fileName === 'synthetic-policy.pdf')!;
    expect(insurance.purpose).toBe('PRIVATE_INSURANCE');
    expect(insurance.sha256).toBe(sha(syntheticPdf));
    const pdf = await page.request.get(origin + `${entryFilesPath}/${insurance.id}/content`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(pdf.headers()['x-content-type-options']).toBe('nosniff');
    expect(sha(await pdf.body())).toBe(sha(syntheticPdf));
    expect(
      (await anonymous.get(origin + `${entryFilesPath}/${insurance.id}/content`)).status(),
    ).toBe(401);
    expect((await scorer.get(origin + `${entryFilesPath}/${insurance.id}/content`)).status()).toBe(
      404,
    );
    const mediaPath = `${root}/matches/${match.id}/media`;
    const filePath = `${root}/matches/${match.id}/media-files`;
    const forbiddenInsurance = await page.request.post(origin + mediaPath, {
      headers: { Origin: origin },
      data: {
        kind: 'IMAGE',
        fileId: insurance.id,
        title: '保险不能公开',
        rightsDeclaration: '这是合成负向验证',
      },
    });
    expect(forbiddenInsurance.status()).toBe(404);
    const png = await write<MediaFileData>(page.request, 'POST', filePath, {
      purpose: 'MATCH_IMAGE',
      fileName: 'synthetic-court.png',
      contentType: 'image/png',
      base64: syntheticPng.toString('base64'),
    });
    const pngContent = await page.request.get(origin + `${filePath}/${png.id}/content`);
    expect(pngContent.status()).toBe(200);
    expect(sha(await pngContent.body())).toBe(sha(syntheticPng));
    progress('real browser uploads the actual synthetic MP4 and creates a private media draft');
    await page.goto(`/matches/${match.id}/scoring`);
    await page.getByRole('button', { name: '管理比赛媒体', exact: true }).click();
    const mediaPanel = page.getByRole('region', { name: '比赛媒体管理', exact: true });
    await mediaPanel.getByLabel('文件用途', { exact: true }).selectOption('MATCH_VIDEO');
    await mediaPanel
      .getByLabel('选择文件', { exact: true })
      .setInputFiles({ name: 'synthetic-match.mp4', mimeType: 'video/mp4', buffer: syntheticMp4 });
    await mediaPanel.getByRole('button', { name: '上传并保存文件', exact: true }).click();
    await expect(mediaPanel.getByLabel('已保存文件')).toContainText('synthetic-match.mp4');
    let workspace = await read<MatchMediaWorkspaceData>(page.request, mediaPath);
    const videoFile = workspace.files.find((f) => f.fileName === 'synthetic-match.mp4')!;
    expect(videoFile.sha256).toBe(sha(syntheticMp4));
    const title = '合成1秒比赛回放';
    await mediaPanel.getByLabel('媒体类型', { exact: true }).selectOption('VIDEO');
    await mediaPanel.getByLabel('已上传媒体文件', { exact: true }).selectOption(videoFile.id);
    await mediaPanel.getByLabel('媒体标题', { exact: true }).fill(title);
    await mediaPanel
      .getByLabel('发布权利声明', { exact: true })
      .fill('合成验收素材仅用于隔离浏览器测试');
    await mediaPanel.getByRole('button', { name: '保存私有媒体草稿', exact: true }).click();
    const card = mediaPanel
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card).toContainText('私有草稿');
    workspace = await read<MatchMediaWorkspaceData>(page.request, mediaPath);
    const source =
      workspace.sourceEvents.find((e) => e.type === 'STAT_RECORDED') ?? workspace.sourceEvents[0]!;
    expect(source).toBeTruthy();
    await card.getByLabel(`${title} 原计分事件`, { exact: true }).selectOption(source.id);
    await card.getByLabel(`${title} 片段说明`, { exact: true }).fill('合成得分片段');
    await card.getByLabel(`${title} 片段开始秒数`, { exact: true }).fill('0.1');
    await card.getByLabel(`${title} 片段结束秒数`, { exact: true }).fill('0.8');
    await card.getByRole('button', { name: '保存人工对时标记', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await read<MatchMediaWorkspaceData>(page.request, mediaPath)).media[0]?.markers.length,
      )
      .toBe(1);
    viewing = await read<EventStandingsData>(page.request, `${eventPath}/standings`);
    viewing = await write<EventStandingsData>(
      page.request,
      'POST',
      `${eventPath}/public-viewing-commands`,
      { type: 'ENABLE', expectedEventVersion: viewing.event.version },
    );
    const grant = viewing.publication!.publicEventId;
    const publicMatch = (
      await read<PublicScheduleMatchData[]>(anonymous, `/v1/public/events/${grant}/schedule`)
    )[0]!;
    const publicMediaPath = `/v1/public/events/${grant}/matches/${publicMatch.publicMatchId}/media`;
    expect((await read<PublicMatchMediaData>(anonymous, publicMediaPath)).media).toHaveLength(0);
    await card.getByRole('button', { name: '公开发布媒体', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '公开发布媒体', exact: true });
    await expect(dialog).toBeVisible();
    expect((await read<PublicMatchMediaData>(anonymous, publicMediaPath)).media).toHaveLength(0);
    await dialog.getByRole('button', { name: '确认公开发布媒体', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const publicData = await read<PublicMatchMediaData>(anonymous, publicMediaPath);
    expect(publicData.media).toHaveLength(1);
    const publicVideo = publicData.media[0]!;
    expect(publicVideo.markers[0]).toMatchObject({
      startMs: 100,
      endMs: 800,
      label: '合成得分片段',
    });
    const contentPath = publicVideo.contentPath!;
    const fullVideo = await anonymous.get(origin + contentPath);
    expect(fullVideo.status()).toBe(200);
    expect(fullVideo.headers()['content-type']).toContain('video/mp4');
    expect(sha(await fullVideo.body())).toBe(sha(syntheticMp4));
    const range = await anonymous.get(origin + contentPath, { headers: { Range: 'bytes=0-31' } });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-range']).toBe(`bytes 0-31/${syntheticMp4.length}`);
    expect(await range.body()).toEqual(syntheticMp4.subarray(0, 32));
    expect(JSON.stringify(publicData)).not.toContain(insurance.id);
    expect(JSON.stringify(publicData)).not.toContain(videoFile.id);
    expect(JSON.stringify(publicData)).not.toContain(source.id);
    progress(
      'anonymous desktop or mobile browser decodes actual video metadata and seeks the published marker',
    );
    publicContext = await browser.newContext({
      ...(testInfo.project.name === 'mobile-api'
        ? devices['iPhone 13']
        : devices['Desktop Chrome']),
      viewport: page.viewportSize()!,
      baseURL: origin,
    });
    const spectator = await publicContext.newPage();
    spectator.on('pageerror', (error) => errors.push(error.message));
    await spectator.goto(`/watch/${grant}/matches/${publicMatch.publicMatchId}`);
    const video = spectator.locator('video');
    await expect(video).toHaveCount(1);
    await expect
      .poll(
        () =>
          video.evaluate(
            (e: HTMLVideoElement) =>
              Number.isFinite(e.duration) &&
              e.duration > 0 &&
              e.duration < 2 &&
              e.videoWidth === 64,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    await spectator.getByRole('button', { name: '定位合成得分片段', exact: true }).click();
    await expect
      .poll(
        () => video.evaluate((e: HTMLVideoElement) => e.currentTime > 0.15 && e.readyState >= 2),
        { timeout: 5000 },
      )
      .toBe(true);
    expect(await spectator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    progress(
      'explicit media revoke clears the spectator player and rejects old full and Range content requests',
    );
    await card.getByRole('button', { name: '撤销媒体发布', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '撤销媒体发布', exact: true });
    await dialog.getByRole('button', { name: '确认撤销媒体发布', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(video).toHaveCount(0, { timeout: 15000 });
    expect((await anonymous.get(origin + contentPath)).status()).toBe(404);
    expect(
      (await anonymous.get(origin + contentPath, { headers: { Range: 'bytes=0-31' } })).status(),
    ).toBe(404);
    expect((await read<PublicMatchMediaData>(anonymous, publicMediaPath)).media).toHaveLength(0);
    expect(errors).toEqual([]);
  } catch (error) {
    throw new Error(`Media browser check failed during: ${phase}`, { cause: error });
  } finally {
    await publicContext?.close();
    await anonymous.dispose();
    await scorer.dispose();
    await leader.dispose();
  }
});
