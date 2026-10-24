const { test } = require('node:test');
const assert = require('node:assert/strict');
const registration = require('../utils/registration');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const rules = {
  id: id(5),
  eventId: id(4),
  createdAt: '2026-10-24T00:00:00Z',
  version: 1,
  minPlayers: 1,
  maxPlayers: 12,
  zeroAndDoubleZeroDistinct: true,
  requireIdentity: false,
  requireInsurance: false,
};
function team() {
  return {
    id: id(2),
    orgId: id(1),
    name: '合成队',
    version: 1,
    members: [{ id: id(3), name: '合成球员' }],
    grants: [],
    capabilities: { canManage: true, canInvite: false },
  };
}
function entry() {
  return {
    id: id(6),
    orgId: id(1),
    teamId: id(2),
    teamName: '合成队',
    eventId: id(4),
    status: 'DRAFT',
    version: 1,
    rules,
    players: [{ memberId: id(3), name: '合成球员', jerseyNo: '00' }],
    history: [],
    capabilities: {
      canEditRoster: true,
      canSubmit: true,
      canWithdraw: true,
      canReview: false,
      canApprove: false,
      canRequestChanges: false,
      canReject: false,
    },
  };
}
const envelope = (data, extra = {}) => ({ data, meta: { requestId: 'test', ...extra } });

test('registration repository binds response resource and organisation rather than trusting a cross-org body', async () => {
  const good = team();
  const repo = registration.createRepository(id(1), {
    request: async () => envelope({ ...good, orgId: id(99) }),
  });
  await assert.rejects(repo.team(good.id), /不完整/);
  assert.throws(() => registration.createRepository('../other'), /编号无效/);
  assert.equal(
    registration.validTeam({ ...good, capabilities: { canManage: 'true', canInvite: false } }),
    false,
  );
});
test('list query uses current private cursor and rejects a nonadvancing or malformed cursor', async () => {
  let path;
  const repo = registration.createRepository(id(1), {
    request: async (p) => {
      path = p;
      return envelope([team()], { nextCursor: 'same', capabilities: { canCreateTeam: false } });
    },
  });
  await assert.rejects(repo.teams('same'), /没有前进/);
  assert.match(path, /\?limit=100&cursor=same$/);
  await assert.rejects(repo.teams('bad?cursor'), /分页/);
});
test('registration events reject another team entry and preserve a valid scheduled event status', async () => {
  const value = {
    event: {
      id: id(4),
      name: '合成赛',
      startDate: '2026-10-24',
      endDate: '2026-11-02',
      version: 2,
      status: 'SCHEDULED',
    },
    rules,
    entry: entry(),
    capabilities: { canCreateEntry: false },
  };
  const repo = registration.createRepository(id(1), {
    request: async () => envelope([value], { nextCursor: null }),
  });
  assert.equal((await repo.events(id(2))).items[0].event.status, 'SCHEDULED');
  value.entry.teamId = id(9);
  await assert.rejects(repo.events(id(2)), /不完整/);
});
test('current member IDs are retained, new draft keys never reach API and cross-page merges deduplicate IDs', async () => {
  assert.deepEqual(
    registration.normalizeMembers([
      { id: id(3), key: 'local', name: ' A ' },
      { key: 'draft-1', name: ' B ' },
    ]),
    [{ id: id(3), name: 'A' }, { name: 'B' }],
  );
  assert.throws(
    () =>
      registration.normalizeMembers([
        { id: id(3), name: 'A' },
        { id: id(3), name: 'B' },
      ]),
    /重复/,
  );
  assert.equal(registration.mergePage([team()], [{ ...team(), version: 2 }])[0].version, 2);
});
test('roster respects 0 versus 00 rule and rejects duplicate identities or archived members', () => {
  const rows = [
    { memberId: id(3), selected: true, jerseyNo: '0' },
    { memberId: id(7), selected: true, jerseyNo: '00' },
  ];
  assert.equal(registration.normalizeRoster(rows, rules).length, 2);
  assert.throws(
    () => registration.normalizeRoster(rows, { ...rules, zeroAndDoubleZeroDistinct: false }),
    /号码重复/,
  );
  assert.throws(() => registration.normalizeRoster([rows[0], rows[0]], rules), /重复/);
  assert.throws(
    () => registration.normalizeRoster([{ ...rows[0], jerseyNo: '01' }], rules),
    /号码需/,
  );
  assert.throws(
    () => registration.normalizeRoster([{ ...rows[0], archived: true }], rules),
    /归档/,
  );
});
test('archived current entries stay visible until explicitly removed; long-term edits do not rewrite snapshots', () => {
  const frozen = entry();
  const rows = registration.rosterRows({ ...team(), members: [] }, frozen);
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].name, frozen.players[0].name);
  assert.equal(rows[0].jerseyNo, '00');
});
test('entry mutations keep reviewed CAS and disallow client-side review commands', async () => {
  const calls = [];
  const repo = registration.createRepository(id(1), {
    request: async (path, method, body) => {
      calls.push({ path, method, body });
      return envelope(entry());
    },
  });
  await repo.roster(id(6), 8, [{ memberId: id(3), jerseyNo: '00' }]);
  assert.deepEqual(calls[0].body, {
    expectedVersion: 8,
    players: [{ memberId: id(3), jerseyNo: '00' }],
  });
  assert.throws(() => repo.command(id(6), 1, 'APPROVE'), /独立审核/);
  assert.throws(
    () => registration.versionMatch({ version: 2 }, 1),
    (e) => e.status === 409 && e.code === 'VERSION_CONFLICT',
  );
});
test('private registration file whitelist rejects active content, path names and size boundary violations', () => {
  const good = { name: '外部保险凭证.PDF', path: '/tmp/private', size: 5 };
  assert.equal(registration.selectedFile(good).contentType, 'application/pdf');
  for (const bad of [
    { ...good, name: 'proof.svg' },
    { ...good, name: '../proof.pdf' },
    { ...good, size: 0 },
    { ...good, size: 8388609 },
    { ...good, name: 'proof.mp4' },
  ])
    assert.throws(() => registration.selectedFile(bad));
});
test('file reader checks decoded byte count and does not accept a changed file with same base64 group length', async () => {
  const file = { name: 'proof.pdf', path: '/tmp/private', size: 4 };
  const wx = {
    getFileSystemManager: () => ({
      readFile(o) {
        o.success({ data: 'JVBERg==' });
      },
    }),
  };
  assert.deepEqual(await registration.readFileBase64(wx, file), {
    fileName: 'proof.pdf',
    contentType: 'application/pdf',
    base64: 'JVBERg==',
  });
  await assert.rejects(registration.readFileBase64(wx, { ...file, size: 5 }), /不一致/);
});
test('invitation token goes only to the fixed accept endpoint for the current account', async () => {
  const calls = [];
  const client = {
    request: async (...args) => {
      calls.push(args);
      return envelope({
        orgId: id(1),
        organizationName: '合成机构',
        teamId: id(2),
        teamName: '合成队',
      });
    },
  };
  await registration.acceptInvitation(id(8), 'x'.repeat(43), client);
  assert.deepEqual(calls[0], [
    '/v1/invitations/' + id(8) + '/accept',
    'POST',
    { token: 'x'.repeat(43) },
  ]);
  await assert.rejects(registration.acceptInvitation(id(8), 'secret', client), /43位/);
});
