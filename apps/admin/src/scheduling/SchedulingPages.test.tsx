// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventSchedulingData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import { CourtsPage } from './CourtsPage';
import { EventSchedulingPage } from './SchedulePages';
import {
  court,
  overview,
  revision,
  currentOverview,
  officialMatches,
  response,
} from './test-fixtures';
import type { RegistrationWorkspace } from '../registration/shared';
function context(fetcher: typeof fetch): RegistrationWorkspace {
  return {
    client: createApiClient({ fetcher }),
    organizationId: 'org-a',
    userId: 'owner-a',
    onSessionRefresh: async () => {},
  };
}
function schedulePage(value: RegistrationWorkspace, path = '/events/event-a/scheduling') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/events/:eventId/scheduling"
          element={<EventSchedulingPage context={value} />}
        />
        <Route
          path="/events/:eventId/scheduling/history/:revisionId"
          element={<EventSchedulingPage context={value} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
const setTime = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('场地与排赛业务界面', () => {
  it('共享场地由服务端能力控制，取消创建不提交，停用冲突保留输入', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_path, init) =>
        init?.method === 'PATCH'
          ? response({ code: 'COURT_IN_USE', message: '该场地仍有未来正式占用，不能停用' }, {}, 409)
          : response([court], { capabilities: { canCreateCourt: true } }),
      );
    render(
      <MemoryRouter>
        <CourtsPage context={context(fetcher)} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '创建场地' }));
    await user.type(screen.getByLabelText('场地名称'), '新共享场地');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '编辑场地' }));
    await user.clear(screen.getByLabelText('场地名称'));
    await user.type(screen.getByLabelText('场地名称'), '重命名场地');
    await user.selectOptions(screen.getByLabelText('场地状态'), 'DISABLED');
    await user.click(screen.getByRole('button', { name: '保存场地' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('仍有未来正式占用');
    expect(screen.getByLabelText('场地名称')).toHaveValue('重命名场地');
    expect(screen.getByLabelText('场地状态')).toHaveValue('DISABLED');
    const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(init?.body))).toEqual({
      name: '重命名场地',
      status: 'DISABLED',
      expectedVersion: 1,
    });
    cleanup();
    const readonly = vi.fn<typeof fetch>().mockResolvedValue(
      response([{ ...court, capabilities: { canManage: false } }], {
        capabilities: { canCreateCourt: false },
      }),
    );
    render(
      <MemoryRouter>
        <CourtsPage context={context(readonly)} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: court.name });
    expect(screen.queryByRole('button', { name: '创建场地' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑场地' })).not.toBeInTheDocument();
  });

  it('球队上下文无法访问场地或排赛，不会请求空机构', () => {
    const fetcher = vi.fn<typeof fetch>();
    const leader = {
      ...context(fetcher),
      organizationId: undefined,
      teamContext: { orgId: 'org-a', organizationName: '机构', teamId: 'team-a', teamName: '球队' },
    };
    render(
      <MemoryRouter>
        <CourtsPage context={leader} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    cleanup();
    schedulePage(leader);
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('缺少freeze及不支持赛制均显示业务原因，不提供生成入口', async () => {
    let workspace = {
      ...overview,
      freeze: null,
      support: { supported: false, reason: '请先冻结报名名单' },
      capabilities: { ...overview.capabilities, canGenerate: false },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts?')
          ? response([court], { capabilities: { canCreateCourt: false } })
          : response(workspace),
      );
    schedulePage(context(fetcher));
    expect(await screen.findByRole('heading', { name: '请先冻结参赛名单' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '生成单循环对阵' })).not.toBeInTheDocument();
    cleanup();
    workspace = {
      ...workspace,
      support: { supported: false, reason: '当前不支持单淘汰排赛，请使用单循环赛事' },
    };
    schedulePage(context(fetcher));
    expect(await screen.findByText('当前不支持单淘汰排赛，请使用单循环赛事')).toBeVisible();
    expect(screen.queryByLabelText('每场占用分钟')).not.toBeInTheDocument();
  });

  it('generates only knockout first-round fixtures with the declared algorithm and renders multiple byes', async () => {
    const knockoutRevision = {
      ...revision,
      algorithmVersion: 'SE_SEEDED_V1',
      rounds: [{ roundNo: 1, byeEntryId: null, byeEntryIds: ['entry-3'] }],
      fixtures: [revision.fixtures[0]!],
    };
    let generated = false;
    const initial = { ...overview, event: { ...overview.event, format: 'SINGLE_ELIMINATION' } };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (String(path).includes('/courts?'))
        return response([court], { capabilities: { canCreateCourt: true } });
      if (init?.method === 'POST') {
        generated = true;
        return response(knockoutRevision);
      }
      if (String(path).endsWith('/schedule-revisions/revision-a'))
        return response(knockoutRevision);
      return response(
        generated
          ? {
              ...initial,
              event: { ...initial.event, version: 11 },
              currentRevision: knockoutRevision,
              capabilities: { ...initial.capabilities, canGenerate: false, canRedraw: true },
            }
          : initial,
      );
    });
    schedulePage(context(fetcher));
    await screen.findByLabelText('每场占用分钟');
    for (const [label, value] of [
      ['每场占用分钟', '60'],
      ['最少休息分钟', '0'],
      ['最小日期间隔', '0'],
      ['窗口1场地', court.id],
      ['窗口1开始时间', '2026-12-01T09:00'],
      ['窗口1结束时间', '2026-12-01T18:00'],
    ])
      setTime(label!, value!);
    fireEvent.click(screen.getByRole('button', { name: '生成淘汰赛签位' }));
    expect(await screen.findByRole('button', { name: '保存全部安排' })).toBeVisible();
    expect(screen.getByText('合成丙队 本轮轮空（无比赛）')).toBeVisible();
    expect(
      JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body)),
    ).toMatchObject({ algorithmVersion: 'SE_SEEDED_V1' });
    expect(screen.getAllByText('VS')).toHaveLength(1);
  });

  it('政策要求显式0间隔，生成使用当前赛事版本而非冻结时版本，时间为UTC+8', async () => {
    let generated = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (String(path).includes('/courts?'))
        return response([court], { capabilities: { canCreateCourt: true } });
      if (init?.method === 'POST') {
        generated = true;
        return response(revision);
      }
      if (String(path).endsWith('/schedule-revisions/revision-a')) return response(revision);
      return response(generated ? currentOverview() : overview);
    });
    schedulePage(context(fetcher));
    const user = userEvent.setup();
    await screen.findByLabelText('每场占用分钟');
    expect(screen.getByLabelText('最少休息分钟')).toHaveValue(null);
    expect(screen.getByLabelText('最小日期间隔')).toHaveValue(null);
    await user.type(screen.getByLabelText('每场占用分钟'), '60');
    await user.click(screen.getByRole('button', { name: '生成单循环对阵' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无间隔时请填写0');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.type(screen.getByLabelText('最少休息分钟'), '0');
    await user.type(screen.getByLabelText('最小日期间隔'), '0');
    await user.selectOptions(screen.getByLabelText('窗口1场地'), court.id);
    setTime('窗口1开始时间', '2026-12-01T09:00');
    setTime('窗口1结束时间', '2026-12-01T18:00');
    await user.click(screen.getByRole('button', { name: '生成单循环对阵' }));
    expect(await screen.findByRole('button', { name: '保存全部安排' })).toBeVisible();
    const [, init] = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedEventVersion: 10,
      freezeId: 'freeze-a',
      algorithmVersion: 'RR_CIRCLE_V1',
      policy: {
        slotDurationMinutes: 60,
        minRestMinutes: 0,
        minLocalDayGap: 0,
        courtWindows: [
          {
            courtId: court.id,
            startsAt: '2026-12-01T09:00:00.000+08:00',
            endsAt: '2026-12-01T18:00:00.000+08:00',
          },
        ],
      },
    });
  });

  it('全量安排保存、冲突定位、取消与摘要确认发布形成只读正式版本', async () => {
    let saved = structuredClone(revision);
    let workspace = currentOverview(saved);
    let validationValid = false;
    let isPublished = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      const url = String(path);
      if (url.includes('/courts?'))
        return response([{ ...court, name: isPublished ? '后来更名球场' : court.name }], {
          capabilities: { canCreateCourt: true },
        });
      if (url.endsWith('/allocations')) {
        const input = JSON.parse(String(init?.body));
        saved = {
          ...saved,
          version: saved.version + 1,
          eventVersion: saved.eventVersion + 1,
          fixtures: saved.fixtures.map((fixture) => {
            const item = input.allocations.find(
              (item: { fixtureKey: string }) => item.fixtureKey === fixture.fixtureKey,
            );
            return {
              ...fixture,
              courtId: item.courtId,
              startsAt: item.startsAt ? new Date(item.startsAt).toISOString() : null,
              endsAt: item.startsAt
                ? new Date(Date.parse(item.startsAt) + 3600000).toISOString()
                : null,
            };
          }),
        };
        workspace = currentOverview(saved);
        return response(saved);
      }
      if (url.endsWith('/validate'))
        return response({
          revisionId: saved.id,
          expectedEventVersion: saved.eventVersion,
          expectedRevisionVersion: saved.version,
          valid: validationValid,
          checkedAt: court.createdAt,
          conflicts: validationValid
            ? []
            : [
                {
                  code: 'COURT_OVERLAP',
                  fixtureKeys: saved.fixtures.map((item) => item.fixtureKey),
                  external: true,
                },
              ],
        });
      if (url.endsWith('/publish')) {
        isPublished = true;
        saved = {
          ...saved,
          status: 'PUBLISHED',
          version: saved.version + 1,
          eventVersion: saved.eventVersion + 1,
          capabilities: { canEditAllocations: false, canValidate: false, canPublish: false },
        };
        workspace = {
          ...currentOverview(saved),
          event: { ...overview.event, status: 'SCHEDULED', version: saved.eventVersion },
          publication: {
            id: 'publication-a',
            eventId: 'event-a',
            revisionId: saved.id,
            publicationHash: 'd'.repeat(64),
            publishedAt: court.createdAt,
            matchCount: 3,
          },
          capabilities: { canGenerate: false, canRedraw: false, canReadMatches: true },
        };
        return response(workspace);
      }
      if (url.includes('/matches?')) return response(officialMatches(saved));
      if (url.endsWith('/schedule-revisions/revision-a')) return response(saved);
      return response(workspace);
    });
    schedulePage(context(fetcher));
    const user = userEvent.setup();
    await screen.findByRole('button', { name: '保存全部安排' });
    for (const fixture of revision.fixtures) {
      const label = `第${fixture.roundNo}轮第${fixture.positionNo}场`;
      await user.selectOptions(screen.getByLabelText(`${label} 场地`), court.id);
      setTime(`${label} 开始时间`, '2026-12-01T09:00');
    }
    expect(screen.getByText(/本地修改未保存/)).toBeVisible();
    expect(screen.getByRole('button', { name: '检查赛程冲突' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '取消本地修改' }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    expect(screen.getByLabelText('第1轮第1场 场地')).toHaveValue('');
    for (const fixture of revision.fixtures) {
      const label = `第${fixture.roundNo}轮第${fixture.positionNo}场`;
      await user.selectOptions(screen.getByLabelText(`${label} 场地`), court.id);
      setTime(`${label} 开始时间`, '2026-12-01T09:00');
    }
    await user.click(screen.getByRole('button', { name: '保存全部安排' }));
    await screen.findByText('全部安排已保存');
    await user.click(await screen.findByRole('button', { name: '检查赛程冲突' }));
    expect(await screen.findByText('场地时间重叠')).toBeVisible();
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '定位第1轮第1场' }));
    expect(screen.getByLabelText('查看轮次')).toHaveValue('1');
    await user.selectOptions(screen.getByLabelText('查看轮次'), 'all');
    for (const fixture of revision.fixtures)
      setTime(
        `第${fixture.roundNo}轮第${fixture.positionNo}场 开始时间`,
        `2026-12-01T${String(7 + fixture.roundNo * 2).padStart(2, '0')}:00`,
      );
    await user.click(screen.getByRole('button', { name: '保存全部安排' }));
    await screen.findByText('全部安排已保存');
    validationValid = true;
    await user.click(await screen.findByRole('button', { name: '检查赛程冲突' }));
    await screen.findByText('当前版本检查通过');
    await user.click(screen.getByRole('button', { name: '发布正式赛程' }));
    expect(screen.getByRole('region', { name: '正式发布确认' })).toHaveTextContent('3场正式比赛');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/publish'))).toBe(false);
    await user.click(screen.getByRole('button', { name: '发布正式赛程' }));
    await user.click(screen.getByRole('button', { name: '确认发布正式赛程' }));
    await screen.findByRole('heading', { name: '正式赛程' });
    expect(screen.queryByRole('button', { name: '保存全部安排' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成对阵' })).not.toBeInTheDocument();
    const list = screen.getByRole('heading', { name: '正式比赛安排' }).closest('section')!;
    expect(within(list).getAllByText('发布时场地名称')).toHaveLength(3);
    expect(within(list).queryByText('后来更名球场')).not.toBeInTheDocument();
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(writes).toHaveLength(2);
    expect(JSON.parse(String(writes[0]![1]?.body))).toMatchObject({
      expectedEventVersion: 11,
      expectedRevisionVersion: 1,
    });
    expect(JSON.parse(String(writes[1]![1]?.body))).toMatchObject({
      expectedEventVersion: 12,
      expectedRevisionVersion: 2,
    });
    expect(JSON.parse(String(writes[1]![1]?.body)).allocations).toHaveLength(3);
  });

  it('保存版本冲突保留本地输入并提供明确重读入口', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path, init) =>
        init?.method === 'PUT'
          ? response({ code: 'VERSION_CONFLICT', message: '他人已修改安排' }, {}, 409)
          : String(path).includes('/courts?')
            ? response([court], { capabilities: { canCreateCourt: true } })
            : String(path).endsWith('/schedule-revisions/revision-a')
              ? response(revision)
              : response(currentOverview()),
      );
    schedulePage(context(fetcher));
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('第1轮第1场 场地'), court.id);
    setTime('第1轮第1场 开始时间', '2026-12-01T09:00');
    await user.click(screen.getByRole('button', { name: '保存全部安排' }));
    await screen.findByText('资料版本已变化');
    expect(screen.getByLabelText('第1轮第1场 开始时间')).toHaveValue('2026-12-01T09:00');
    expect(screen.getByRole('button', { name: '重新读取最新资料' })).toBeVisible();
  });

  it('发布时新出现的外部冲突使旧检查失效并显示可定位问题', async () => {
    const saved = {
      ...revision,
      fixtures: revision.fixtures.map((item, index) => ({
        ...item,
        courtId: court.id,
        startsAt: `2026-12-01T0${index * 2 + 1}:00:00.000Z`,
        endsAt: `2026-12-01T0${index * 2 + 2}:00:00.000Z`,
      })),
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) =>
      String(path).includes('/courts?')
        ? response([court], { capabilities: { canCreateCourt: true } })
        : String(path).endsWith('/validate')
          ? response({
              revisionId: saved.id,
              expectedEventVersion: 11,
              expectedRevisionVersion: 1,
              valid: true,
              checkedAt: court.createdAt,
              conflicts: [],
            })
          : String(path).endsWith('/publish')
            ? response(
                {
                  code: 'SCHEDULE_CONFLICT',
                  message: '其他正式比赛刚刚占用此场地',
                  details: {
                    conflicts: [
                      {
                        code: 'COURT_OVERLAP',
                        fixtureKeys: [saved.fixtures[0]!.fixtureKey],
                        external: true,
                      },
                    ],
                  },
                },
                {},
                409,
              )
            : String(path).endsWith('/schedule-revisions/revision-a')
              ? response(saved)
              : response(currentOverview(saved)),
    );
    schedulePage(context(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '检查赛程冲突' }));
    await screen.findByText('当前版本检查通过');
    await user.click(screen.getByRole('button', { name: '发布正式赛程' }));
    await user.click(screen.getByRole('button', { name: '确认发布正式赛程' }));
    expect(await screen.findByText('场地时间重叠')).toBeVisible();
    expect(screen.queryByText('当前版本检查通过')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '定位第1轮第1场' })).toBeVisible();
  });

  it('重新生成表单与旧稿发布互斥，必填原因，重读撤权后表单关闭', async () => {
    let allowed = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (String(path).includes('/courts?'))
        return response([court], { capabilities: { canCreateCourt: false } });
      if (String(path).endsWith('/validate'))
        return response({
          revisionId: revision.id,
          expectedEventVersion: 11,
          expectedRevisionVersion: 1,
          valid: true,
          checkedAt: court.createdAt,
          conflicts: [],
        });
      if (String(path).endsWith('/schedule-revisions/revision-a'))
        return response({
          ...revision,
          capabilities: { canEditAllocations: allowed, canValidate: allowed, canPublish: allowed },
        });
      return response({
        ...currentOverview(),
        capabilities: { canGenerate: false, canRedraw: allowed, canReadMatches: true },
      });
    });
    schedulePage(context(fetcher));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '检查赛程冲突' }));
    await screen.findByText('当前版本检查通过');
    await user.click(screen.getByRole('button', { name: '重新生成对阵' }));
    expect(screen.queryByRole('button', { name: '发布正式赛程' })).not.toBeInTheDocument();
    expect(screen.queryByText('当前版本检查通过')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('每场占用分钟'));
    await user.type(screen.getByLabelText('每场占用分钟'), '90');
    await user.click(screen.getByRole('button', { name: '确认重新生成对阵' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('重新生成原因');
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/schedule-revisions'))).toBe(
      false,
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '发布正式赛程' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重新生成对阵' }));
    allowed = false;
    await user.click(screen.getByRole('button', { name: '重新读取资料' }));
    await screen.findByText(
      '当前身份没有生成或重新生成此赛事对阵的权限，赛事状态与实际工作人员授权由服务核验。',
    );
    expect(screen.queryByLabelText('每场占用分钟')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认重新生成对阵' })).not.toBeInTheDocument();
  });

  it('历史与只读staff不提供编辑、重新生成或发布入口', async () => {
    const historical = {
      ...revision,
      status: 'SUPERSEDED' as const,
      isCurrent: false,
      redrawReason: '人工核对后重新抽取',
      capabilities: { canEditAllocations: false, canValidate: false, canPublish: false },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts?')
          ? response([court], { capabilities: { canCreateCourt: false } })
          : String(path).endsWith('/schedule-revisions/revision-a')
            ? response(historical)
            : response(currentOverview()),
      );
    schedulePage(context(fetcher), '/events/event-a/scheduling/history/revision-a');
    expect(await screen.findByText('历史工作稿 · 已由新版本替代')).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存全部安排' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成对阵' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布正式赛程' })).not.toBeInTheDocument();
    cleanup();
    const readonly = {
      ...revision,
      capabilities: { canEditAllocations: false, canValidate: false, canPublish: false },
    };
    const readonlyOverview: EventSchedulingData = {
      ...currentOverview(readonly),
      capabilities: { canGenerate: false, canRedraw: false, canReadMatches: true },
    };
    const reader = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/courts?')
          ? response([court], { capabilities: { canCreateCourt: false } })
          : String(path).endsWith('/schedule-revisions/revision-a')
            ? response(readonly)
            : response(readonlyOverview),
      );
    schedulePage(context(reader));
    await screen.findByText('按轮安排比赛');
    expect(screen.queryByLabelText('第1轮第1场 场地')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查赛程冲突' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成对阵' })).not.toBeInTheDocument();
  });
});
