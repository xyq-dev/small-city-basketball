const api = require('./api');
const ui = require('./ui');

// C18 public event directory (anonymous). Requests go through requestPublic: no session cookie
// is sent, no Set-Cookie is read, and an error never signs the user out.
const GROUPS = [
  { value: 'LIVE', label: '进行中' },
  { value: 'UPCOMING', label: '即将开始' },
  { value: 'HISTORY', label: '历史赛事' },
];
const PAGE_SIZE = 20;
const CITY = /^[A-Za-z0-9 ·一-鿿]+$/;
const FIELDS = [
  'publicEventId',
  'name',
  'startDate',
  'endDate',
  'venueName',
  'status',
  'purpose',
  'displayCity',
].sort();

function initialState() {
  return {
    group: 'LIVE',
    city: '',
    cityInput: '',
    cityError: '',
    items: [],
    loading: false,
    loadingMore: false,
    loaded: false,
    done: false,
    error: '',
    moreError: '',
  };
}

/** Same canonical form as the server: null for empty, undefined when not allowed. */
function normalizeCity(raw) {
  const value = String(raw || '')
    .normalize('NFC')
    .replace(/[\s　]+/g, ' ')
    .trim();
  if (!value) return null;
  return Array.from(value).length <= 20 && CITY.test(value) ? value : undefined;
}

function groupOf(status, purpose) {
  if (purpose === 'LIVE' && status === 'RUNNING') return 'live';
  if (purpose === 'LIVE' && status === 'SCHEDULED') return 'upcoming';
  return 'finished';
}

function view(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Object.keys(raw).sort().join(',') !== FIELDS.join(',') ||
    !/^[A-Za-z0-9_-]{43}$/.test(raw.publicEventId) ||
    typeof raw.name !== 'string'
  )
    throw new Error('公开赛事资料格式无效');
  return {
    publicEventId: raw.publicEventId,
    name: raw.name,
    dateLabel: raw.startDate === raw.endDate ? raw.startDate : raw.startDate + ' 至 ' + raw.endDate,
    venueName: raw.venueName || '场地待定',
    displayCity: raw.displayCity || '',
    statusLabel: api.eventStatus(raw.status),
    group: groupOf(raw.status, raw.purpose),
  };
}

async function fetchPage(client, { group, city, cursor }) {
  const query = ['status=' + group, 'limit=' + PAGE_SIZE];
  if (city) query.push('city=' + encodeURIComponent(city));
  if (cursor) query.push('cursor=' + encodeURIComponent(cursor));
  const response = await client.requestPublic('/v1/public/directory?' + query.join('&'));
  if (!Array.isArray(response.data)) throw new Error('公开赛事资料格式无效');
  const next = response.meta && response.meta.nextCursor;
  if (next !== null && next !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(next))
    throw new Error('公开赛事分页资料无效');
  return { items: response.data.map(view), nextCursor: next || null };
}

/** Concurrent listing changes can shift pages; keep the first occurrence of each event. */
function merge(existing, incoming) {
  const seen = new Set(existing.map((e) => e.publicEventId));
  return existing.concat(
    incoming.filter((e) => !seen.has(e.publicEventId) && seen.add(e.publicEventId)),
  );
}

function failure(error) {
  if (error && error.status === 429) return '读取过于频繁，请稍后再试。';
  if (error && error.code === 'INVALID_CURSOR') return '分页已变化，请重新读取。';
  return ui.message(error);
}

module.exports = { GROUPS, PAGE_SIZE, initialState, normalizeCity, fetchPage, merge, failure };
