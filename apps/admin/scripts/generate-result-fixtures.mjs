/** Regenerate after `npm run build --workspace @small-city-basketball/api`.
 * Synthetic rows pass the real administrative evidence/topology checks. Public
 * fixtures come from the actual StandingsService projection; only DB reads are replaced.
 */
import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { calculateKnockout, generateKnockoutPairings } from '../../api/dist/knockout-domain.js';
import {
  calculateGroupKnockout,
  generateGroupPairings,
} from '../../api/dist/group-knockout-domain.js';
import { calculateStandings } from '../../api/dist/standings-domain.js';
import { StandingsService } from '../../api/dist/standings-service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asOf = '2026-10-31T00:00:00.000Z',
  seed = '00'.repeat(32),
  publicationId = id(900);
const source = {
  id: id(500),
  eventId: id(501),
  rulesetId: id(502),
  rulesetVersion: 1,
  eventVersion: 7,
  entries: Array.from({ length: 4 }, (_, i) => ({
    entryId: id(i + 1),
    teamId: id(i + 101),
    teamName: `合成队${i + 1}`,
    rosterRevisionId: id(i + 201),
    players: [{ memberId: id(i + 301), name: `合成球员${i + 1}`, jerseyNo: String(i + 1) }],
  })),
  excludedCounts: { DRAFT: 0, REJECTED: 0, WITHDRAWN: 0 },
  createdAt: asOf,
};
const policy = {
  slotDurationMinutes: 60,
  minRestMinutes: 0,
  minLocalDayGap: 0,
  thirdPlaceMatch: true,
  courtWindows: [
    { courtId: id(600), startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' },
  ],
};
const rules = {
  id: id(800),
  eventId: source.eventId,
  version: 1,
  algorithmVersion: 'RR_STANDINGS_V1',
  winPoints: 2,
  lossPoints: 0,
  drawPoints: 1,
  tiebreakers: ['WINS'],
  createdAt: asOf,
};
function match(f, kind = 'FORFEIT') {
  const home = source.entries.find((e) => e.entryId === f.homeEntryId),
    away = source.entries.find((e) => e.entryId === f.awayEntryId),
    n = f.roundNo * 100 + f.positionNo;
  const r = {
    id: id(1000 + n),
    event_id: source.eventId,
    publication_id: publicationId,
    revision_id: id(901),
    fixture_key: f.fixtureKey,
    round_no: f.roundNo,
    position_no: f.positionNo,
    home_entry_id: home.entryId,
    home_team_id: home.teamId,
    home_team_name: home.teamName,
    home_roster_revision_id: home.rosterRevisionId,
    away_entry_id: away.entryId,
    away_team_id: away.teamId,
    away_team_name: away.teamName,
    away_roster_revision_id: away.rosterRevisionId,
    court_id: id(600),
    court_name: '合成场地',
    starts_at: new Date(Date.parse('2026-11-01T00:00:00Z') + f.roundNo * 86400000).toISOString(),
    ends_at: new Date(Date.parse('2026-11-01T01:00:00Z') + f.roundNo * 86400000).toISOString(),
    status: 'SCHEDULED',
    version: 1,
    state: null,
    confirmation: null,
    last_event: null,
    last_command: null,
    scoring_rules: null,
    public_match_id: String(n).padStart(43, '0'),
  };
  return {
    ...r,
    exception_checked: true,
    exception_head: { version: 2, active_request_id: id(5000 + n) },
    exception_request: {
      id: id(5000 + n),
      event_id: r.event_id,
      match_id: r.id,
      status: 'APPROVED',
      operation: 'DECLARE',
      version: 2,
      source_match_version: 1,
      rules_id: id(700),
      rules_version: 1,
      proposed_by: id(710),
      reviewed_by: id(711),
      reviewed_at: asOf,
      kind,
      forfeiting_side: kind === 'FORFEIT' ? 'HOME' : null,
      winner_entry_id: kind === 'FORFEIT' ? away.entryId : null,
      loser_entry_id: kind === 'FORFEIT' ? home.entryId : null,
    },
    exception_rules: {
      id: id(700),
      event_id: r.event_id,
      version: 1,
      forfeit_win_points: 2,
      forfeit_loss_points: 0,
      cancellation_policy: 'EXCLUDE_FROM_TABLE',
    },
  };
}
const participants = source.entries.map(({ players, ...p }) => p);
const event = {
  id: source.eventId,
  name: '合成裁定赛事',
  startDate: '2026-11-01',
  endDate: '2026-11-10',
  timezone: 'Asia/Shanghai',
  venueName: '合成球馆',
  format: 'SINGLE_ELIMINATION',
  status: 'SCHEDULED',
  version: 7,
  createdAt: asOf,
  updatedAt: asOf,
};
const draw = generateKnockoutPairings(source, policy, seed),
  matches = draw.fixtures.map((f) => match(f));
const params = { publicationId, source, seed, policy, matches, asOf, roundPublications: [] };
const bracket = calculateKnockout(params);
const knockout = {
  event,
  publicationId,
  participants,
  bracket,
  capabilities: { canPublishNextRound: true },
};
const completeMatches = [...matches, ...bracket.nextRound.fixtures.map((f) => match(f))];
const complete = calculateKnockout({
  ...params,
  matches: completeMatches,
  roundPublications: [{ roundNo: bracket.nextRound.roundNo, sources: bracket.nextRound.sources }],
});
const knockoutComplete = {
  ...knockout,
  bracket: complete,
  capabilities: { canPublishNextRound: false },
};
const config = { groupCount: 2, seededEntryIds: source.entries.slice(0, 2).map((e) => e.entryId) };
const groupDraw = generateGroupPairings(source, policy, seed, config);
const groupInput = {
  publicationId,
  source,
  seed,
  policy,
  config,
  rules,
  matches: groupDraw.fixtures.map((f) => match(f)),
  asOf,
  draws: [],
  qualification: null,
  roundPublications: [],
};
const competition = calculateGroupKnockout(groupInput);
const groups = {
  event: { ...event, format: 'GROUP_KNOCKOUT' },
  publicationId,
  config,
  competition,
  capabilities: { canDrawTies: true, canPublishQualification: true, canPublishNextRound: false },
};
const cancelledGroups = {
  ...groups,
  competition: calculateGroupKnockout({
    ...groupInput,
    matches: groupDraw.fixtures.map((f) => match(f, 'CANCELLED')),
  }),
};
const teamKeys = Object.fromEntries(participants.map((p, i) => [p.entryId, String(i).repeat(22)]));
let bundle;
const service = Object.create(StandingsService.prototype);
service.transaction = async (work) => work({});
service.publicBundle = async () => bundle;
service.participants = () => participants;
const pub = { team_keys: teamKeys };
bundle = { bracket, plan: {}, rows: matches, pub };
const publicKnockout = await service.getPublicKnockout('public-synthetic-event');
bundle = { ...bundle, bracket: complete, rows: completeMatches };
const publicKnockoutComplete = await service.getPublicKnockout('public-synthetic-event');
bundle = {
  groupCompetition: competition,
  rules,
  now: asOf,
  pub,
  plan: {},
  rows: groupInput.matches,
  bracket: null,
};
const publicGroups = await service.getPublicGroups('public-synthetic-event');
bundle = { ...bundle, groupCompetition: cancelledGroups.competition };
const publicCancelledGroups = await service.getPublicGroups('public-synthetic-event');
const tableMatches = [
  match({ fixtureKey: 'R1-P1', roundNo: 1, positionNo: 1, homeEntryId: id(1), awayEntryId: id(2) }),
  match(
    { fixtureKey: 'R2-P1', roundNo: 2, positionNo: 1, homeEntryId: id(2), awayEntryId: id(1) },
    'CANCELLED',
  ),
];
const table = calculateStandings({
  participants: participants.slice(0, 2),
  matches: tableMatches,
  rules,
  publicationId,
  asOf,
  mode: 'PUBLISHED',
  format: 'DOUBLE_ROUND_ROBIN',
});
bundle = {
  event: {
    id: event.id,
    name: event.name,
    start_date: event.startDate,
    end_date: event.endDate,
    timezone: event.timezone,
    venue_name: event.venueName,
    status: event.status,
    format: 'DOUBLE_ROUND_ROBIN',
  },
  rules,
  standings: table,
  groupCompetition: null,
  bracket: null,
  rows: tableMatches,
  pub,
  now: asOf,
};
const publicEvent = await service.getPublicEvent('public-synthetic-event');
const publicStandings = await service.getPublicStandings('public-synthetic-event');
const publicForfeit = service.publicMatch(tableMatches[0], pub),
  publicCancellation = service.publicMatch(tableMatches[1], pub);
const publicSnapshot = await service.getPublicMatch(
  'public-synthetic-event',
  tableMatches[0].public_match_id,
);
await writeFile(
  new URL('../src/api/test-fixtures/result-domain.json', import.meta.url),
  await format(
    JSON.stringify(
      {
        knockout,
        knockoutComplete,
        publicKnockout,
        publicKnockoutComplete,
        groups,
        cancelledGroups,
        publicGroups,
        publicCancelledGroups,
        publicEvent,
        publicStandings,
        publicForfeit,
        publicCancellation,
        publicSnapshot,
      },
      null,
      2,
    ),
    { parser: 'json', printWidth: 96 },
  ),
);
