const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const registration = require('../utils/registration');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const envelope = (data, extra = {}) => ({ data, meta: { requestId: 'test', ...extra } });
function team() {
  return {
    id: id(2),
    orgId: id(1),
    name: '合成队',
    version: 1,
    members: [{ id: id(3), name: '球员甲' }],
    grants: [],
    capabilities: { canManage: true, canInvite: false },
  };
}
function entry(overrides = {}) {
  return {
    id: id(6),
    orgId: id(1),
    teamId: id(2),
    teamName: '合成队',
    eventId: id(4),
    status: 'DRAFT',
    version: 1,
    rules: {
      id: id(5),
      eventId: id(4),
      createdAt: '2026-10-24T00:00:00Z',
      version: 1,
      minPlayers: 1,
      maxPlayers: 12,
      zeroAndDoubleZeroDistinct: true,
      requireIdentity: false,
      requireInsurance: false,
    },
    players: [{ memberId: id(3), name: '球员甲', jerseyNo: '00' }],
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
    ...overrides,
  };
}
function files() {
  return {
    entryId: id(6),
    entryVersion: 1,
    rosterRevisionId: id(10),
    files: [
      {
        id: id(9),
        purpose: 'PRIVATE_INSURANCE',
        fileName: 'proof.pdf',
        contentType: 'application/pdf',
        sha256: 'a'.repeat(64),
        createdAt: '2026-10-24T00:00:00Z',
        byteLength: 4,
        version: 1,
        status: 'ACTIVE',
      },
    ],
    usage: { usedBytes: 4, maxFileBytes: 8388608, limitBytes: 134217728 },
    capabilities: { canUpload: true, canRevoke: true, canPurge: true },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
function page(name, request, options = {}) {
  let definition,
    revision = 0,
    actor = id(11);
  const calls = [],
    nav = [];
  const client = {
    sessionRevision: () => revision,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    download: options.download,
  };
  const ui = {
    message: (e) => e.message || '读取失败',
    async session(p) {
      return {
        user: { id: actor, displayName: '测试账号' },
        organizations: [{ id: id(1), name: '合成机构', role: 'ORG_ADMIN' }],
        teamContexts: [
          { orgId: id(1), teamId: id(2), organizationName: '合成机构', teamName: '合成队' },
        ],
      };
    },
    begin(p) {
      p._generation = (p._generation || 0) + 1;
      return { generation: p._generation, revision };
    },
    live: (p, token) =>
      p._alive && token.generation === p._generation && token.revision === revision,
    close(p) {
      p._generation++;
    },
    confirm: options.confirm || (async () => true),
    open: (...args) => nav.push(args),
    login() {},
  };
  const adapter = {
    ...registration,
    createRepository: (org) => registration.createRepository(org, client),
    acceptInvitation: (invitationId, token) =>
      registration.acceptInvitation(invitationId, token, client),
  };
  const wx = { env: { USER_DATA_PATH: '/private-temp' }, ...options.wx };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8'), {
    Page(value) {
      definition = value;
    },
    require(value) {
      if (value.endsWith('/api')) return { getClient: () => client };
      if (value.endsWith('/ui')) return ui;
      if (value.endsWith('/registration')) return adapter;
      throw new Error(value);
    },
    wx,
    Promise,
    Date,
    Set,
    Map,
    ArrayBuffer,
  });
  const instance = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  instance.onLoad({ orgId: id(1), teamId: id(2), entryId: id(6) });
  return {
    instance,
    calls,
    nav,
    client,
    changeActor() {
      actor = id(12);
      revision++;
    },
    ui,
  };
}
function defaultRequest(path) {
  if (path.endsWith('/media-files')) return envelope(files());
  if (path.endsWith('/teams/' + id(2))) return envelope(team());
  return envelope(entry());
}

test('entry starts unchecked and cannot submit before explicit review or while draft is dirty', async () => {
  const { instance, calls } = page('entry', defaultRequest);
  await instance.load();
  assert.equal(instance.data.consent, false);
  await instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  assert.equal(
    calls.some((c) => c[1] === 'POST'),
    false,
  );
  instance.consent({ detail: { value: ['yes'] } });
  instance.data.dirty = true;
  await instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  assert.equal(
    calls.some((c) => c[1] === 'POST'),
    false,
  );
});
test('submit rechecks actual version and canSubmit, then sends the reviewed entry CAS only', async () => {
  const { instance, calls } = page('entry', (p, method, body) =>
    method === 'POST' ? envelope(entry({ status: 'SUBMITTED', version: 2 })) : defaultRequest(p),
  );
  await instance.load();
  instance.consent({ detail: { value: ['yes'] } });
  await instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  const write = calls.find((c) => c[1] === 'POST');
  assert.equal(write[0], '/v1/orgs/' + id(1) + '/entries/' + id(6) + '/commands');
  assert.equal(write[2].expectedVersion, 1);
  assert.equal(write[2].type, 'SUBMIT');
  assert.equal(instance.data.entry.status, 'SUBMITTED');
  assert.equal(instance.data.consent, false);
});
test('new server version stops stale roster overwrite without silently adopting the newer CAS', async () => {
  let reads = 0;
  const { instance, calls } = page('entry', (p) =>
    p.endsWith('/entries/' + id(6))
      ? envelope(entry({ version: ++reads > 1 ? 2 : 1 }))
      : defaultRequest(p),
  );
  await instance.load();
  instance.jersey({ currentTarget: { dataset: { index: 0 } }, detail: { value: '9' } });
  await instance.saveRoster();
  assert.equal(
    calls.some((c) => c[1] === 'PUT'),
    false,
  );
  assert.match(instance.data.error, /资料已变化/);
  assert.equal(instance.data.rows[0].jerseyNo, '9');
});
test('identity or insurance requirements cannot be bypassed merely by uploading a file or checking consent', async () => {
  const locked = entry();
  locked.rules.requireInsurance = true;
  locked.capabilities.canSubmit = false;
  const { instance, calls } = page('entry', (p) =>
    p.endsWith('/entries/' + id(6)) ? envelope(locked) : defaultRequest(p),
  );
  await instance.load();
  instance.consent({ detail: { value: ['yes'] } });
  await instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  assert.equal(
    calls.some((c) => c[1] === 'POST'),
    false,
  );
});
test('revoked entry access clears previous names, roster and private files instead of retaining a fallback', async () => {
  let revoked = false;
  const { instance } = page('entry', (p) => {
    if (revoked) throw { status: 404, message: '权限失效' };
    return defaultRequest(p);
  });
  await instance.load();
  assert.equal(instance.data.files.length, 1);
  revoked = true;
  await instance.load();
  assert.equal(instance.data.entry, null);
  assert.equal(instance.data.rows.length, 0);
  assert.equal(instance.data.files.length, 0);
});
test('late private entry response cannot restore old actor data after session revision change or unload', async () => {
  const delayed = deferred();
  const context = page('entry', () => delayed.promise);
  const loading = context.instance.load();
  await turn();
  context.changeActor();
  context.instance.onUnload();
  delayed.resolve(envelope(entry()));
  await loading;
  assert.equal(context.instance.data.entry, null);
  assert.equal(context.instance.data.files.length, 0);
});
test('file selection uploads current reviewed version and explicit purpose with no fabricated insurance verification', async () => {
  const uploaded = files().files[0];
  const wx = {
    chooseMessageFile(o) {
      o.success({ tempFiles: [{ name: 'proof.pdf', path: '/tmp/proof', size: 4 }] });
    },
    getFileSystemManager: () => ({
      readFile(o) {
        o.success({ data: 'JVBERg==' });
      },
    }),
  };
  const { instance, calls } = page(
    'entry',
    (p, method) => (method === 'POST' ? envelope(uploaded) : defaultRequest(p)),
    { wx },
  );
  await instance.load();
  instance.fileConsent({ detail: { value: ['yes'] } });
  await instance.upload();
  const write = calls.find((c) => c[1] === 'POST');
  assert.equal(write[2].purpose, 'PRIVATE_INSURANCE');
  assert.equal(write[2].expectedEntryVersion, 1);
  assert.equal(write[2].base64, 'JVBERg==');
  assert.equal(Object.hasOwn(write[2], 'verified'), false);
  assert.equal(instance.data.fileConsent, false);
});
test('session switch while native file chooser is open prevents the upload continuation', async () => {
  let choose;
  const context = page('entry', defaultRequest, {
    wx: {
      chooseMessageFile(o) {
        choose = o;
      },
      getFileSystemManager: () => ({
        readFile() {
          throw new Error('must not read');
        },
      }),
    },
  });
  await context.instance.load();
  context.instance.fileConsent({ detail: { value: ['yes'] } });
  const uploading = context.instance.upload();
  await turn();
  context.changeActor();
  choose.success({ tempFiles: [{ name: 'proof.pdf', path: '/tmp/proof', size: 4 }] });
  await uploading;
  assert.equal(
    context.calls.some((c) => c[1] === 'POST'),
    false,
  );
});
test('late file write after onHide is explicitly removed even if earlier cleanup preceded file creation', async () => {
  let finishWrite,
    opened = false;
  const removed = [];
  const context = page('entry', defaultRequest, {
    download: async () => ({
      data: new Uint8Array([1, 2, 3, 4]).buffer,
      contentType: 'application/pdf',
    }),
    wx: {
      getFileSystemManager: () => ({
        writeFile(o) {
          finishWrite = o.success;
        },
        unlink(o) {
          removed.push(o.filePath);
          if (removed.length === 1) o.fail({ errMsg: 'file does not exist yet' });
          else o.success();
        },
      }),
      openDocument() {
        opened = true;
      },
    },
  });
  await context.instance.load();
  const viewing = context.instance.viewFile({ currentTarget: { dataset: { id: id(9) } } });
  await turn();
  context.instance.onHide();
  finishWrite();
  await viewing;
  assert.equal(opened, false);
  assert.equal(removed.length, 2);
  assert.equal(context.instance._temporaryFiles.length, 0);
});
test('invitation secret is never put in reactive data and is cleared on hide/unload', async () => {
  const context = page('invitation', async () =>
    envelope({ orgId: id(1), organizationName: '合成机构', teamId: id(2), teamName: '合成队' }),
  );
  await context.instance.load();
  context.instance.token({ detail: { value: 's'.repeat(43) } });
  assert.equal(JSON.stringify(context.instance.data).includes('s'.repeat(43)), false);
  context.instance.onHide();
  assert.equal(context.instance._token, '');
  assert.equal(context.instance.data.tokenVisible, false);
  assert.equal(typeof context.instance.onShareAppMessage, 'undefined');
});
test('actor change during invitation confirmation cannot consume the old actor consent', async () => {
  const confirmation = deferred();
  const context = page(
    'invitation',
    async () => envelope({ orgId: id(1), organizationName: '机构', teamId: id(2), teamName: '队' }),
    { confirm: () => confirmation.promise },
  );
  await context.instance.load();
  context.instance.data.invitationId = id(8);
  context.instance.token({ detail: { value: 's'.repeat(43) } });
  context.instance.consent({ detail: { value: ['yes'] } });
  const accepting = context.instance.accept();
  await turn();
  context.changeActor();
  confirmation.resolve(true);
  await accepting;
  assert.equal(context.calls.length, 0);
  assert.equal(context.instance._token, '');
});

test('team editor rechecks reviewed version before rename and keeps the unsaved name on conflict', async () => {
  let reads = 0;
  const context = page('team', () => envelope({ ...team(), version: ++reads > 1 ? 2 : 1 }));
  await context.instance.load();
  context.instance.inputName({ detail: { value: '修改中的球队名' } });
  await context.instance.save({ currentTarget: { dataset: { mode: 'name' } } });
  assert.equal(
    context.calls.some((c) => c[1] === 'PATCH'),
    false,
  );
  assert.match(context.instance.data.error, /资料已变化/);
  assert.equal(context.instance.data.name, '修改中的球队名');
  assert.equal(context.instance.data.busy, false);
  assert.equal(context.instance.data.nameDirty, true);
});

test('entry current capability loss prevents submission even after a previous visible consent', async () => {
  let reads = 0;
  const context = page('entry', (p) => {
    if (p.endsWith('/entries/' + id(6))) {
      const value = entry();
      if (++reads > 1) value.capabilities.canSubmit = false;
      return envelope(value);
    }
    return defaultRequest(p);
  });
  await context.instance.load();
  context.instance.consent({ detail: { value: ['yes'] } });
  await context.instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  assert.equal(
    context.calls.some((c) => c[1] === 'POST'),
    false,
  );
  assert.match(context.instance.data.error, /权限或报名状态已变化/);
});

test('private file revocation clears prior metadata and never opens a stale local view', async () => {
  let opened = false;
  const context = page('entry', defaultRequest, {
    download: async () => {
      throw { status: 404, message: '文件已撤销' };
    },
    wx: {
      getFileSystemManager: () => ({ unlink() {} }),
      openDocument() {
        opened = true;
      },
    },
  });
  await context.instance.load();
  await context.instance.viewFile({ currentTarget: { dataset: { id: id(9) } } });
  assert.equal(context.instance.data.files.length, 0);
  assert.equal(context.instance.data.fileWorkspace, null);
  assert.equal(opened, false);
});

test('an entry request is not created a second time when the current event already has a team entry', async () => {
  const value = {
    event: {
      id: id(4),
      name: '合成赛',
      startDate: '2026-10-24',
      endDate: '2026-11-02',
      version: 1,
      status: 'REGISTRATION_OPEN',
    },
    rules: entry().rules,
    entry: entry(),
    capabilities: { canCreateEntry: false },
  };
  const context = page('registration-events', (p) =>
    p.includes('/registration-events') ? envelope([value], { nextCursor: null }) : envelope(team()),
  );
  await context.instance.load();
  await context.instance.enter({ currentTarget: { dataset: { id: id(4) } } });
  assert.equal(
    context.calls.some((c) => c[1] === 'POST'),
    false,
  );
  assert.equal(context.nav[0][0], 'entry');
  assert.equal(context.nav[0][1].orgId, id(1));
  assert.equal(context.nav[0][1].entryId, id(6));
});

test('refresh invalidates an older private-file response before the new session preflight completes', async () => {
  const oldFiles = deferred(),
    nextSession = deferred();
  let reads = 0;
  const context = page('entry', (p) => {
    if (p.endsWith('/media-files') && ++reads === 1) return oldFiles.promise;
    return defaultRequest(p);
  });
  const first = context.instance.load();
  await turn();
  const oldSession = context.ui.session;
  context.ui.session = () => nextSession.promise;
  const second = context.instance.load();
  oldFiles.resolve(envelope(files()));
  await first;
  assert.equal(context.instance.data.files.length, 0);
  assert.equal(context.instance.data.fileWorkspace, null);
  nextSession.resolve(await oldSession());
  await second;
  assert.equal(context.instance.data.files.length, 1);
});

test('team creation locks the selected institution before a delayed session check and ignores picker changes or repeated taps', async () => {
  const context = page('teams', (p, method, body) =>
    method === 'POST'
      ? envelope({ ...team(), name: body.name })
      : envelope([], { nextCursor: null, capabilities: { canCreateTeam: true } }),
  );
  const session = await context.ui.session();
  session.organizations.push({ id: id(21), name: '机构B', role: 'ORG_ADMIN' });
  context.ui.session = async () => session;
  await context.instance.load();
  context.instance.input({ detail: { value: '机构A球队' } });
  const gate = deferred();
  let sessionChecks = 0;
  context.ui.session = () => {
    sessionChecks++;
    return gate.promise;
  };
  const creating = context.instance.create();
  try {
    assert.equal(context.instance.data.busy, true);
    context.instance.selectOrg({ detail: { value: '1' } });
    await context.instance.create();
    assert.equal(context.instance.data.selectedOrg, id(1));
    assert.equal(context.instance.data.newName, '机构A球队');
    assert.equal(sessionChecks, 1);
    assert.equal(
      context.calls.some((c) => c[1] === 'POST'),
      false,
    );
  } finally {
    gate.resolve(session);
  }
  await creating;
  const writes = context.calls.filter((c) => c[1] === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], '/v1/orgs/' + id(1) + '/teams');
  assert.equal(writes[0][2].name, '机构A球队');
  assert.equal(context.nav[0][1].orgId, id(1));
});

test('a programmatic institution change during team-create preflight aborts rather than retargeting the frozen intent', async () => {
  const context = page('teams', () =>
    envelope([], { nextCursor: null, capabilities: { canCreateTeam: true } }),
  );
  await context.instance.load();
  context.instance.input({ detail: { value: '机构A球队' } });
  const session = await context.ui.session(),
    gate = deferred();
  context.ui.session = () => gate.promise;
  const creating = context.instance.create();
  context.instance.setData({ selectedOrg: id(21) });
  gate.resolve(session);
  await creating;
  assert.equal(
    context.calls.some((c) => c[1] === 'POST'),
    false,
  );
  assert.equal(context.instance.data.busy, false);
  assert.match(context.instance.data.error, /创建上下文已变化/);
});

function editTeamWhileBusy(instance) {
  instance.inputName({ detail: { value: 'Second edit' } });
  instance.memberName({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 'Second member' },
  });
  instance.addMember();
  instance.removeMember({ currentTarget: { dataset: { index: 0 } } });
}

for (const mode of ['name', 'members']) {
  test(
    'team ' +
      mode +
      ' save locks editing before confirmation/session preflight and preserves the other draft',
    async () => {
      const confirmation = deferred(),
        sessionCheck = deferred();
      const context = page(
        'team',
        (p, method, body) =>
          envelope({
            ...team(),
            ...(method === 'PATCH' ? { name: body.name, version: 2 } : {}),
            ...(method === 'PUT' ? { members: body.members, version: 2 } : {}),
          }),
        { confirm: () => confirmation.promise },
      );
      await context.instance.load();
      context.instance.inputName({ detail: { value: 'First edit' } });
      context.instance.memberName({
        currentTarget: { dataset: { index: 0 } },
        detail: { value: 'First member' },
      });
      const session = await context.ui.session();
      let checks = 0;
      context.ui.session = () => {
        checks++;
        return sessionCheck.promise;
      };
      const saving = context.instance.save({ currentTarget: { dataset: { mode } } });
      assert.equal(context.instance.data.busy, true);
      editTeamWhileBusy(context.instance);
      await context.instance.save({
        currentTarget: { dataset: { mode: mode === 'name' ? 'members' : 'name' } },
      });
      assert.equal(context.instance.data.name, 'First edit');
      assert.equal(context.instance.data.members.length, 1);
      assert.equal(context.instance.data.members[0].name, 'First member');
      if (mode === 'members') {
        assert.equal(checks, 0);
        confirmation.resolve(true);
        await turn();
        assert.equal(context.instance.data.busy, true);
        editTeamWhileBusy(context.instance);
      }
      assert.equal(checks, 1);
      sessionCheck.resolve(session);
      await saving;
      const writes = context.calls.filter((c) => ['PATCH', 'PUT'].includes(c[1]));
      assert.equal(writes.length, 1);
      assert.equal(writes[0][2].expectedVersion, 1);
      if (mode === 'name') {
        assert.equal(writes[0][2].name, 'First edit');
        assert.equal(context.instance.data.nameDirty, false);
        assert.equal(context.instance.data.membersDirty, true);
        assert.equal(context.instance.data.members[0].name, 'First member');
      } else {
        assert.equal(writes[0][2].members[0].name, 'First member');
        assert.equal(context.instance.data.membersDirty, false);
        assert.equal(context.instance.data.nameDirty, true);
        assert.equal(context.instance.data.name, 'First edit');
      }
      assert.equal(context.instance.data.busy, false);
    },
  );
}

test('cancelling long-term-member confirmation unlocks editing without discarding the draft', async () => {
  const confirmation = deferred();
  const context = page('team', () => envelope(team()), { confirm: () => confirmation.promise });
  await context.instance.load();
  context.instance.memberName({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 'First member' },
  });
  const saving = context.instance.save({ currentTarget: { dataset: { mode: 'members' } } });
  assert.equal(context.instance.data.busy, true);
  confirmation.resolve(false);
  await saving;
  assert.equal(context.instance.data.busy, false);
  assert.equal(context.instance.data.membersDirty, true);
  assert.equal(context.instance.data.members[0].name, 'First member');
  assert.equal(context.calls.length, 1);
  context.instance.memberName({
    currentTarget: { dataset: { index: 0 } },
    detail: { value: 'Second member' },
  });
  assert.equal(context.instance.data.members[0].name, 'Second member');
});

function editEntryWhileBusy(instance) {
  instance.togglePlayer({ currentTarget: { dataset: { index: 0 } } });
  instance.jersey({ currentTarget: { dataset: { index: 0 } }, detail: { value: '99' } });
  instance.consent({ detail: { value: [] } });
  instance.fileConsent({ detail: { value: [] } });
  instance.reason({ detail: { value: 'Second reason' } });
  instance.purpose({ detail: { value: '1' } });
}

test('SUBMIT locks the reviewed roster and declaration throughout confirmation and a delayed actor check', async () => {
  const confirmation = deferred(),
    sessionCheck = deferred();
  const context = page(
    'entry',
    (p, method) =>
      method === 'POST' ? envelope(entry({ status: 'SUBMITTED', version: 2 })) : defaultRequest(p),
    { confirm: () => confirmation.promise },
  );
  await context.instance.load();
  context.instance.consent({ detail: { value: ['yes'] } });
  context.instance.fileConsent({ detail: { value: ['yes'] } });
  context.instance.reason({ detail: { value: 'First reason' } });
  const session = await context.ui.session();
  let checks = 0;
  context.ui.session = () => {
    checks++;
    return sessionCheck.promise;
  };
  const submitting = context.instance.command({ currentTarget: { dataset: { type: 'SUBMIT' } } });
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  assert.equal(checks, 0);
  confirmation.resolve(true);
  await turn();
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  await context.instance.command({ currentTarget: { dataset: { type: 'WITHDRAW' } } });
  await context.instance.saveRoster();
  assert.equal(checks, 1);
  assert.equal(context.instance.data.rows[0].selected, true);
  assert.equal(context.instance.data.rows[0].jerseyNo, '00');
  assert.equal(context.instance.data.dirty, false);
  assert.equal(context.instance.data.consent, true);
  assert.equal(context.instance.data.fileConsent, true);
  assert.equal(context.instance.data.reason, 'First reason');
  assert.equal(context.instance.data.uploadPurpose, 'PRIVATE_INSURANCE');
  sessionCheck.resolve(session);
  await submitting;
  const writes = context.calls.filter((c) => c[1] === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].type, 'SUBMIT');
  assert.equal(writes[0][2].expectedVersion, 1);
  assert.equal(writes[0][2].reason, 'First reason');
  assert.equal(context.instance.data.entry.status, 'SUBMITTED');
  assert.equal(context.instance.data.busy, false);
});

test('roster save locks its captured jersey draft before the delayed actor check', async () => {
  const context = page('entry', (p, method, body) =>
    method === 'PUT'
      ? envelope(
          entry({
            version: 2,
            players: body.players.map((player) => ({ ...player, name: '球员甲' })),
          }),
        )
      : defaultRequest(p),
  );
  await context.instance.load();
  context.instance.jersey({ currentTarget: { dataset: { index: 0 } }, detail: { value: '11' } });
  const session = await context.ui.session(),
    sessionCheck = deferred();
  context.ui.session = () => sessionCheck.promise;
  const saving = context.instance.saveRoster();
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  await context.instance.saveRoster();
  assert.equal(context.instance.data.rows[0].jerseyNo, '11');
  assert.equal(context.instance.data.rows[0].selected, true);
  sessionCheck.resolve(session);
  await saving;
  const writes = context.calls.filter((c) => c[1] === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].players[0].jerseyNo, '11');
  assert.equal(context.instance.data.rows[0].jerseyNo, '11');
  assert.equal(context.instance.data.dirty, false);
  assert.equal(context.instance.data.busy, false);
});

test('upload freezes consent, purpose and roster before a delayed actor check', async () => {
  let choices = 0;
  const context = page(
    'entry',
    (p, method) => (method === 'POST' ? envelope(files().files[0]) : defaultRequest(p)),
    {
      wx: {
        chooseMessageFile(options) {
          choices++;
          options.success({
            tempFiles: [{ name: 'proof.pdf', size: 4, path: '/chosen/proof.pdf' }],
          });
        },
        getFileSystemManager: () => ({
          readFile(options) {
            options.success({ data: 'JVBERg==' });
          },
        }),
      },
    },
  );
  await context.instance.load();
  context.instance.fileConsent({ detail: { value: ['yes'] } });
  const session = await context.ui.session(),
    sessionCheck = deferred();
  context.ui.session = () => sessionCheck.promise;
  const uploading = context.instance.upload();
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  await context.instance.upload();
  assert.equal(choices, 0);
  assert.equal(context.instance.data.fileConsent, true);
  assert.equal(context.instance.data.uploadPurpose, 'PRIVATE_INSURANCE');
  assert.equal(context.instance.data.dirty, false);
  sessionCheck.resolve(session);
  await uploading;
  const writes = context.calls.filter((c) => c[1] === 'POST');
  assert.equal(choices, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].purpose, 'PRIVATE_INSURANCE');
  assert.equal(writes[0][2].expectedEntryVersion, 1);
  assert.equal(context.instance.data.busy, false);
});

test('file revocation locks its reason and file version before confirmation and actor preflight', async () => {
  const confirmation = deferred(),
    sessionCheck = deferred();
  const context = page(
    'entry',
    (p, method) => (method === 'POST' ? envelope(files().files[0]) : defaultRequest(p)),
    { confirm: () => confirmation.promise },
  );
  await context.instance.load();
  context.instance.reason({ detail: { value: 'First reason' } });
  const session = await context.ui.session();
  context.ui.session = () => sessionCheck.promise;
  const revoking = context.instance.revoke({ currentTarget: { dataset: { id: id(9) } } });
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  confirmation.resolve(true);
  await turn();
  assert.equal(context.instance.data.busy, true);
  editEntryWhileBusy(context.instance);
  await context.instance.revoke({ currentTarget: { dataset: { id: id(9) } } });
  sessionCheck.resolve(session);
  await revoking;
  const writes = context.calls.filter((c) => c[1] === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2].reason, 'First reason');
  assert.equal(writes[0][2].expectedVersion, 1);
  assert.equal(context.instance.data.busy, false);
});

for (const operation of ['SUBMIT', 'WITHDRAW', 'revoke']) {
  test(
    'cancelling ' + operation + ' confirmation releases the entry write lock without a request',
    async () => {
      const confirmation = deferred();
      const context = page('entry', defaultRequest, { confirm: () => confirmation.promise });
      await context.instance.load();
      context.instance.consent({ detail: { value: ['yes'] } });
      context.instance.reason({ detail: { value: 'First reason' } });
      const before = context.calls.length;
      const saving =
        operation === 'revoke'
          ? context.instance.revoke({ currentTarget: { dataset: { id: id(9) } } })
          : context.instance.command({ currentTarget: { dataset: { type: operation } } });
      assert.equal(context.instance.data.busy, true);
      confirmation.resolve(false);
      await saving;
      assert.equal(context.instance.data.busy, false);
      assert.equal(context.instance.data.consent, true);
      assert.equal(context.instance.data.reason, 'First reason');
      assert.equal(context.calls.length, before);
      context.instance.jersey({
        currentTarget: { dataset: { index: 0 } },
        detail: { value: '12' },
      });
      assert.equal(context.instance.data.rows[0].jerseyNo, '12');
    },
  );
}

for (const failure of ['null', 'throw']) {
  test(
    'team and entry writes unlock and preserve drafts after a ' + failure + ' session preflight',
    async () => {
      for (const operation of ['name', 'members', 'saveRoster', 'SUBMIT', 'upload', 'revoke']) {
        const teamPage = ['name', 'members'].includes(operation);
        const context = page(
          teamPage ? 'team' : 'entry',
          teamPage ? () => envelope(team()) : defaultRequest,
          {
            wx: {
              chooseMessageFile() {
                throw new Error('chooser must not open');
              },
            },
          },
        );
        await context.instance.load();
        if (teamPage) {
          context.instance.inputName({ detail: { value: 'First edit' } });
          context.instance.memberName({
            currentTarget: { dataset: { index: 0 } },
            detail: { value: 'First member' },
          });
        } else {
          context.instance.consent({ detail: { value: ['yes'] } });
          context.instance.fileConsent({ detail: { value: ['yes'] } });
          context.instance.reason({ detail: { value: 'First reason' } });
          if (operation === 'saveRoster')
            context.instance.jersey({
              currentTarget: { dataset: { index: 0 } },
              detail: { value: '11' },
            });
        }
        context.ui.session = async () => {
          if (failure === 'throw') throw new Error('session unavailable');
          return null;
        };
        const before = context.calls.length;
        if (teamPage)
          await context.instance.save({ currentTarget: { dataset: { mode: operation } } });
        else if (operation === 'SUBMIT')
          await context.instance.command({ currentTarget: { dataset: { type: operation } } });
        else if (operation === 'revoke')
          await context.instance.revoke({ currentTarget: { dataset: { id: id(9) } } });
        else await context.instance[operation]();
        assert.equal(context.instance.data.busy, false, operation);
        assert.equal(context.instance.data.uncertain, false, operation);
        assert.equal(context.calls.length, before, operation);
        if (teamPage) {
          assert.equal(context.instance.data.name, 'First edit', operation);
          assert.equal(context.instance.data.members[0].name, 'First member', operation);
          assert.equal(context.instance.data.nameDirty, true, operation);
          assert.equal(context.instance.data.membersDirty, true, operation);
        } else if (operation === 'saveRoster') {
          assert.equal(context.instance.data.rows[0].jerseyNo, '11');
          assert.equal(context.instance.data.dirty, true);
        }
      }
    },
  );
}

test('cancelling native file selection releases the upload lock without posting', async () => {
  const context = page('entry', defaultRequest, {
    wx: {
      chooseMessageFile(options) {
        options.fail();
      },
    },
  });
  await context.instance.load();
  context.instance.fileConsent({ detail: { value: ['yes'] } });
  await context.instance.upload();
  assert.equal(context.instance.data.busy, false);
  assert.equal(context.instance.data.uncertain, false);
  assert.equal(
    context.calls.some((c) => c[1] === 'POST'),
    false,
  );
});

for (const pageName of ['team', 'entry']) {
  test('a stale ' + pageName + ' save cannot release a later request lock', async () => {
    const context = page(pageName, pageName === 'team' ? () => envelope(team()) : defaultRequest);
    await context.instance.load();
    if (pageName === 'team') context.instance.inputName({ detail: { value: 'First edit' } });
    else
      context.instance.jersey({
        currentTarget: { dataset: { index: 0 } },
        detail: { value: '11' },
      });
    const session = await context.ui.session(),
      sessionCheck = deferred();
    context.ui.session = () => sessionCheck.promise;
    const saving =
      pageName === 'team'
        ? context.instance.save({ currentTarget: { dataset: { mode: 'name' } } })
        : context.instance.saveRoster();
    assert.equal(context.instance.data.busy, true);
    context.ui.begin(context.instance);
    context.instance.setData({ busy: true });
    sessionCheck.resolve(session);
    await saving;
    assert.equal(context.instance.data.busy, true);
    assert.equal(
      context.calls.some((c) => ['PUT', 'PATCH', 'POST'].includes(c[1])),
      false,
    );
  });
}
