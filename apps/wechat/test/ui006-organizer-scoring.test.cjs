const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPreview } = require('./helpers/native-preview.cjs');
const { loadPage } = require('./helpers/native-page.cjs');

const wechat = path.resolve(__dirname, '..');
const assignments = {
  'org-event': '36:92',
  'event-setup': '36:93',
  'staff-configuration': '36:94',
  'entry-review': '36:95',
  schedule: '36:96',
  bracket: '36:97',
  reschedule: '36:98 / 36:139',
  seasons: '36:99',
  'scoring-tasks': '36:100',
  'org-match': '36:101',
  scorer: '36:102 / 36:137',
  'match-exceptions': '36:103',
  'season-grants': '36:104',
  'match-media': '36:105',
  'live-studio': '36:106',
  'media-jobs': '36:107',
};

function page(name, ext) {
  return fs.readFileSync(path.join(wechat, 'pages', name, 'index.' + ext), 'utf8');
}

test('UI006 organizer and scoring routes use the isolated Figma page system', () => {
  for (const [name, node] of Object.entries(assignments)) {
    const wxml = page(name, 'wxml');
    const wxss = page(name, 'wxss');
    assert.match(wxml, /figma-page/, `${name} (${node}) must use the rebuilt page root`);
    assert.match(wxml, /figma-section/, `${name} (${node}) must render complete native sections`);
    assert.match(wxml, /figma-fixed-actions/, `${name} (${node}) must reserve its fixed action area`);
    assert.match(
      wxss,
      /^@import "\.\.\/\.\.\/styles\/figma-pages\.wxss";/,
      `${name} (${node}) must import the scoped shared page primitives`,
    );
    assert.doesNotMatch(wxml, /class="page(?:\s|\")|ui002-workspace/);
    assert.doesNotMatch(wxml + wxss, /figma\.com\/api\/mcp\/asset|9:41|▮▮▮|•••/);
    assert.doesNotMatch(wxml, /type=(?:"permission"|"unknown")/);
    assert.doesNotMatch(wxss, /width:\s*(?:320|390|430)px/);
  }
});

test('all assigned native templates expand at 320, 390 and 430 without unresolved bindings', () => {
  for (const name of Object.keys(assignments)) {
    for (const width of [320, 390, 430]) {
      const preview = buildPreview({
        root: wechat,
        route: `pages/${name}/index`,
        width,
        height: 844,
      });
      assert.equal(preview.width, width);
      assert.match(preview.phone, /figma-page/);
      assert.doesNotMatch(preview.phone, /\{\{/);
    }
  }
});

test('rebuilt runtime templates never ship the scores or team names from the Figma examples', () => {
  for (const name of Object.keys(assignments)) {
    const source = page(name, 'wxml') + page(name, 'js');
    assert.doesNotMatch(source, /城北(?:篮球)?队|江南(?:篮球)?队/);
    assert.doesNotMatch(source, />\s*(?:68|64|42|38)\s*</);
  }
});

test('organizer mutations retain version, source and independent-confirmation guards', () => {
  assert.match(page('org-event', 'js'), /expectedEventVersion/);
  assert.match(page('event-setup', 'js'), /expectedEventVersion/);
  assert.match(page('staff-configuration', 'js'), /clientRequestId/);
  assert.match(page('staff-configuration', 'js'), /expectedVersion/);
  assert.match(page('entry-review', 'js'), /expectedEventVersion|expectedVersion/);
  assert.match(page('schedule', 'js'), /expectedEventVersion/);
  assert.match(page('bracket', 'js'), /expectedSourceHash/);
  assert.match(page('reschedule', 'js'), /expectedMatchVersion|expectedVersion/);
  assert.match(page('seasons', 'js'), /model\.updateInput\(season|model\.commandInput\(season/);
  assert.match(page('seasons', 'js'), /snapshot = JSON\.stringify\(season\)/);
  assert.match(page('season-grants', 'js'), /acknowledged/);
  assert.match(page('match-exceptions', 'wxml'), /独立复核/);
});

test('scoring and media templates keep unknown outcomes recoverable and writes serialized', () => {
  const orgMatch = page('org-match', 'js');
  const scorer = page('scorer', 'js');
  const media = page('match-media', 'js');
  const live = page('live-studio', 'js');
  const jobs = page('media-jobs', 'js');

  assert.match(orgMatch, /pending/);
  assert.match(orgMatch, /scoring\.envelope/);
  assert.match(scorer, /scorekeeper-lease/);
  assert.match(scorer, /fencingToken/);
  assert.match(scorer, /按原编号重发/);
  assert.match(media, /clientRequestId/);
  assert.match(media, /publishConsent/);
  assert.match(media, /rightsDeclaration/);
  assert.match(live, /expectedVersion/);
  assert.match(live, /clientRequestId/);
  assert.match(jobs, /expectedVersion/);
  assert.match(jobs, /clientRequestId/);
});

test('organizer and media screens keep the complete Figma section order', () => {
  assert.match(page('org-event', 'wxml'), /报名、记分与积分规则/);
  assert.match(page('staff-configuration', 'wxml'), /在指定机构或赛事范围内一次调整一项授权/);
  assert.match(page('entry-review', 'wxml'), /退回补齐[\s\S]*查看逐人资料/);

  const reschedule = page('reschedule', 'wxml');
  assert.ok(reschedule.indexOf('原安排') < reschedule.indexOf('新安排'));
  assert.ok(reschedule.indexOf('新安排') < reschedule.indexOf('提交前检查'));

  const tasks = page('scoring-tasks', 'wxml');
  assert.match(tasks, /记分任务[\s\S]*待复核[\s\S]*任务范围/);

  const jobs = page('media-jobs', 'wxml');
  assert.ok(jobs.indexOf('录像校准') < jobs.indexOf('处理任务'));
  assert.ok(jobs.indexOf('处理任务') < jobs.indexOf('授权交付'));
});

test('media tabs expose one job domain at a time and exclude recording from processing jobs', () => {
  const markup = page('media-jobs', 'wxml');
  assert.match(markup, /mediaTab === 'recording'/);
  assert.match(markup, /mediaTab === 'jobs'/);
  assert.match(markup, /mediaTab === 'artifacts'/);
  assert.match(markup, /item\.kind !== 'RECORDING'/);
  const h = loadPage({ root: wechat, route: 'pages/media-jobs/index' }).page;
  h.setData({ expandedJobId: 'job', expandedArtifactId: 'artifact', calibrationOpen: true });
  h.changeMediaTab({ currentTarget: { dataset: { tab: 'jobs' } } });
  assert.equal(h.data.mediaTab, 'jobs');
  assert.equal(h.data.expandedJobId, '');
  assert.equal(h.data.calibrationOpen, false);
});

test('critical controls expose at least a 44px target at 320, 390 and 430 layouts', () => {
  const shared = fs.readFileSync(path.join(wechat, 'styles', 'figma-pages.wxss'), 'utf8');
  assert.match(shared, /\.figma-action[\s\S]*height:\s*48px/);
  assert.match(shared, /\.figma-row[\s\S]*min-height:\s*55px/);
  assert.match(shared, /@media \(max-width:\s*360px\)/);

  for (const name of ['bracket', 'org-match', 'scorer', 'match-media']) {
    const wxss = page(name, 'wxss');
    assert.match(wxss, /height:\s*44px|min-height:\s*44px/);
    assert.doesNotMatch(wxss, /width:\s*390px/);
  }
  assert.match(page('org-event', 'wxss'), /\.org-data-switch button\s*\{[^}]*min-height:\s*44px/);
  assert.match(page('scorer', 'wxss'), /#scorer-lineup[\s\S]*order:\s*10/);
  assert.match(page('scorer', 'wxss'), /#scorer-offline\s*\{\s*order:\s*30/);
});
