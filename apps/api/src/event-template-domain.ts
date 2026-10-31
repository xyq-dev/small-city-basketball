import { createHash } from 'node:crypto';
import { EVENT_FORMATS } from '@small-city-basketball/contracts';
import type { EventFormat } from '@small-city-basketball/contracts';
import type {
  EventTemplateConfiguration,
  EventTemplatePreset,
  EventTemplateScheduling,
  EventSetupGuide,
} from '../../../packages/contracts/event-templates.js';
import { eventInput, invalid, objectInput, resourceId, text } from './validation.js';
import { expectedVersion, rulesInput } from './registration-validation.js';
import { parseScoringRules } from './scoring-domain.js';
import { parseStandingsRules } from './standings-domain.js';

export const configurationHash = (value: EventTemplateConfiguration) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (v: unknown, field: string, min: number, max: number) => {
  if (!Number.isInteger(v) || Number(v) < min || Number(v) > max)
    invalid('模板配置无效', { [field]: `请输入${min}至${max}的整数` });
  return v as number;
};
export function parseTemplateScheduling(
  raw: unknown,
  format: EventFormat,
): EventTemplateScheduling {
  const r = objectInput(raw, [
    'dailyStart',
    'dailyEnd',
    'slotDurationMinutes',
    'minRestMinutes',
    'minLocalDayGap',
    'groupCount',
    'thirdPlaceMatch',
  ]);
  const clock = (v: unknown) =>
    typeof v === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
  if (!clock(r.dailyStart) || !clock(r.dailyEnd) || String(r.dailyEnd) <= String(r.dailyStart))
    invalid('模板每日结束时间须晚于开始时间');
  const slotDurationMinutes = integer(r.slotDurationMinutes, 'slotDurationMinutes', 1, 1440);
  const minute = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  if (minute(String(r.dailyEnd)) - minute(String(r.dailyStart)) < slotDurationMinutes)
    invalid('每日时段不足以安排一场比赛');
  if (typeof r.thirdPlaceMatch !== 'boolean') invalid('请明确模板是否安排季军赛');
  if (r.thirdPlaceMatch && !['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(format))
    invalid('仅淘汰赛制可以安排季军赛');
  if (
    format === 'GROUP_KNOCKOUT'
      ? ![2, 4, 8].includes(Number(r.groupCount)) || !Number.isInteger(r.groupCount)
      : r.groupCount !== null
  )
    invalid('分组配置与模板赛制不匹配');
  return {
    dailyStart: String(r.dailyStart),
    dailyEnd: String(r.dailyEnd),
    slotDurationMinutes,
    minRestMinutes: integer(r.minRestMinutes, 'minRestMinutes', 0, 43200),
    minLocalDayGap: integer(r.minLocalDayGap, 'minLocalDayGap', 0, 365),
    groupCount: r.groupCount as 2 | 4 | 8 | null,
    thirdPlaceMatch: r.thirdPlaceMatch,
  };
}
export function parseTemplateConfiguration(raw: unknown): EventTemplateConfiguration {
  const r = objectInput(raw, [
    'format',
    'registration',
    'scoring',
    'standings',
    'scheduling',
    'expectedTeams',
  ]);
  if (!(EVENT_FORMATS as readonly unknown[]).includes(r.format)) invalid('模板赛制无效');
  const format = r.format as EventFormat;
  const registrationRaw = objectInput(r.registration, [
    'minPlayers',
    'maxPlayers',
    'zeroAndDoubleZeroDistinct',
    'requireIdentity',
    'requireInsurance',
    'requireParticipantMaterials',
  ]);
  const { expectedVersion: _, ...registration } = rulesInput({
    ...registrationRaw,
    expectedVersion: 1,
  });
  const scoring = parseScoringRules(r.scoring);
  if (['SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(format) && scoring.tiePolicy !== 'OVERTIME')
    invalid('淘汰赛模板必须设置平分加时');
  const standings =
    format === 'SINGLE_ELIMINATION'
      ? r.standings === null
        ? null
        : invalid('单淘汰模板无需积分规则')
      : parseStandingsRules(r.standings);
  const scheduling = parseTemplateScheduling(r.scheduling, format);
  const expectedTeams =
    r.expectedTeams === null ? null : integer(r.expectedTeams, 'expectedTeams', 2, 32);
  if (
    expectedTeams !== null &&
    ((format === 'GROUP_KNOCKOUT' && expectedTeams < scheduling.groupCount! * 2) ||
      (scheduling.thirdPlaceMatch && expectedTeams < 4))
  )
    invalid('预期队数不足以进行此模板赛制');
  return { format, registration, scoring, standings, scheduling, expectedTeams };
}
export function templatePresets(): EventTemplatePreset[] {
  return [
    {
      key: 'EIGHT_TEAM_GROUP_BRONZE_V1',
      name: '8队分组冠军赛（含季军）',
      expectedTotalMatches: 16,
      configuration: parseTemplateConfiguration({
        format: 'GROUP_KNOCKOUT',
        expectedTeams: 8,
        registration: {
          minPlayers: 5,
          maxPlayers: 15,
          zeroAndDoubleZeroDistinct: true,
          requireIdentity: false,
          requireInsurance: false,
          requireParticipantMaterials: false,
        },
        scoring: {
          regulationPeriods: 4,
          periodDurationSeconds: 600,
          allowedScoreValues: [1, 2, 3],
          tiePolicy: 'OVERTIME',
          overtimeDurationSeconds: 300,
        },
        standings: {
          winPoints: 2,
          lossPoints: 1,
          drawPoints: 1,
          tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
        },
        scheduling: {
          dailyStart: '09:00',
          dailyEnd: '21:00',
          slotDurationMinutes: 60,
          minRestMinutes: 60,
          minLocalDayGap: 0,
          groupCount: 2,
          thirdPlaceMatch: true,
        },
      }),
    },
  ];
}
export function parseTemplateCommand(raw: unknown) {
  const outer = objectInput(raw, [
    'type',
    'clientRequestId',
    'templateId',
    'templateVersionId',
    'expectedTemplateVersion',
    'name',
    'configuration',
    'reason',
    'presetKey',
    'event',
    'eventId',
    'expectedEventVersion',
    'scheduling',
    'expectedTeams',
  ]);
  const type = outer.type;
  const allowed =
    type === 'CREATE_TEMPLATE'
      ? ['name', 'configuration']
      : type === 'UPDATE_TEMPLATE'
        ? ['templateId', 'expectedTemplateVersion', 'name', 'configuration']
        : type === 'ARCHIVE_TEMPLATE'
          ? ['templateId', 'expectedTemplateVersion', 'reason']
          : type === 'CREATE_FROM_EVENT'
            ? ['eventId', 'expectedEventVersion', 'name', 'scheduling', 'expectedTeams']
            : type === 'INSTANTIATE'
              ? outer.presetKey !== undefined
                ? ['presetKey', 'event']
                : ['templateId', 'templateVersionId', 'expectedTemplateVersion', 'event']
              : invalid('无效模板命令');
  objectInput(raw, ['type', 'clientRequestId', ...allowed]);
  const base = {
    type,
    clientRequestId: resourceId(
      typeof outer.clientRequestId === 'string' ? outer.clientRequestId : '',
    ),
  };
  if (type === 'CREATE_TEMPLATE' || type === 'UPDATE_TEMPLATE') {
    const values = {
      ...base,
      name: text(outer.name, 'name', 1, 80),
      configuration: parseTemplateConfiguration(outer.configuration),
    };
    if (type === 'UPDATE_TEMPLATE')
      return {
        ...values,
        type: 'UPDATE_TEMPLATE' as const,
        templateId: resourceId(String(outer.templateId || '')),
        expectedTemplateVersion: expectedVersion(outer.expectedTemplateVersion),
      };
    return { ...values, type: 'CREATE_TEMPLATE' as const };
  }
  if (type === 'ARCHIVE_TEMPLATE')
    return {
      ...base,
      type: 'ARCHIVE_TEMPLATE' as const,
      templateId: resourceId(String(outer.templateId || '')),
      expectedTemplateVersion: expectedVersion(outer.expectedTemplateVersion),
      reason: text(outer.reason, 'reason', 4, 500),
    };
  if (type === 'CREATE_FROM_EVENT')
    return {
      ...base,
      type: 'CREATE_FROM_EVENT' as const,
      eventId: resourceId(String(outer.eventId || '')),
      expectedEventVersion: expectedVersion(outer.expectedEventVersion),
      name: text(outer.name, 'name', 1, 80),
      scheduling: parseTemplateScheduling(
        outer.scheduling,
        (outer.scheduling as Record<string, unknown>)?.groupCount === null
          ? 'SINGLE_ELIMINATION'
          : 'GROUP_KNOCKOUT',
      ),
      expectedTeams:
        outer.expectedTeams === null ? null : integer(outer.expectedTeams, 'expectedTeams', 2, 32),
    };
  const event = objectInput(outer.event, ['name', 'startDate', 'endDate', 'venueName']);
  const { input } = eventInput({ ...event, format: 'ROUND_ROBIN', timezone: 'Asia/Shanghai' });
  const normalizedEvent = {
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    venueName: input.venueName,
  };
  if (outer.presetKey !== undefined) {
    if (outer.presetKey !== 'EIGHT_TEAM_GROUP_BRONZE_V1') invalid('无效模板预设');
    return {
      ...base,
      type: 'INSTANTIATE' as const,
      presetKey: outer.presetKey,
      event: normalizedEvent,
    };
  }
  return {
    ...base,
    type: 'INSTANTIATE' as const,
    templateId: resourceId(String(outer.templateId || '')),
    templateVersionId: resourceId(String(outer.templateVersionId || '')),
    expectedTemplateVersion: expectedVersion(outer.expectedTemplateVersion),
    event: normalizedEvent,
  };
}

export interface GuideFacts {
  eventVersion: number;
  status: string;
  format: EventFormat;
  canManage: boolean;
  registrationRules: boolean;
  scoringRules: boolean;
  standingsLocked: boolean;
  registrationBlocked: boolean;
  template: EventSetupGuide['template'];
  frozen: boolean;
  revision: boolean;
  published: boolean;
  conflicts: number;
  counts: EventSetupGuide['counts'];
}
export function deriveSetupGuide(f: GuideFacts): EventSetupGuide {
  const definitions = [
    ['CONFIGURE', '配置赛事与规则', 'SETUP'],
    ['REGISTRATION', '开放报名与审核', 'REGISTRATION'],
    ['FREEZE', '关闭报名并冻结名单', 'REGISTRATION'],
    ['DRAW', '生成或抽签对阵', 'SCHEDULING'],
    ['ALLOCATE', '排时与冲突校验', 'SCHEDULING'],
    ['PUBLISH', '正式发布赛程', 'SCHEDULING'],
  ] as const;
  const config = [
    !f.registrationRules && '请设置报名规则',
    !f.scoringRules && '请设置记分规则',
    f.format !== 'SINGLE_ELIMINATION' && !f.standingsLocked && '请设置并锁定积分规则',
  ].filter(Boolean) as string[];
  const mismatch =
    f.frozen &&
    f.template?.expectedTeams !== null &&
    f.template?.expectedTeams !== undefined &&
    f.counts.frozen !== f.template.expectedTeams;
  const blockers = [
    config,
    f.registrationBlocked ? ['报名资料配置尚未满足开放条件，请核对本人资料要求与服务器配置'] : [],
    [
      ...(f.counts.submitted || f.counts.changesRequested
        ? ['仍有待审核或需补正报名，请先处理']
        : []),
      ...(f.status === 'REGISTRATION_OPEN' ? ['请先关闭报名'] : []),
      ...(!f.frozen ? ['请冻结已批准参赛名单；此操作会重验资格'] : []),
    ],
    mismatch
      ? [
          `模板要求${f.template!.expectedTeams}支球队，实际冻结${f.counts.frozen}支，请调整报名或另建赛事`,
        ]
      : [],
    f.conflicts ? [`仍有${f.conflicts}项排程冲突或未分配场次`] : [],
    [],
  ];
  const done = [
    config.length === 0,
    f.frozen ||
      ['REGISTRATION_CLOSED', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'ARCHIVED'].includes(f.status),
    f.frozen,
    f.revision,
    f.revision &&
      f.counts.fixtures > 0 &&
      f.counts.assigned === f.counts.fixtures &&
      f.conflicts === 0,
    f.published,
  ];
  let active = false;
  const steps = definitions.map(([code, title, action], i) => {
    const complete = done[i];
    const state = complete
      ? ('COMPLETE' as const)
      : active
        ? ('WAITING' as const)
        : blockers[i]!.length
          ? ('BLOCKED' as const)
          : ('CURRENT' as const);
    if (!complete) active = true;
    return { code, title, action, state, blockers: complete ? [] : blockers[i]! };
  });
  return {
    eventVersion: f.eventVersion,
    template: f.template,
    steps,
    counts: f.counts,
    published: f.published,
    canManage: f.canManage,
  };
}
