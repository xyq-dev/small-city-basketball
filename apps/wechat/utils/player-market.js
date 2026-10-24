// Presentation-only catalog state. Never retain sessions, profiles or private orders here.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positions = { PG: '控球后卫', SG: '得分后卫', SF: '小前锋', PF: '大前锋', C: '中锋' };
const positionOptions = ['全部位置', '控球后卫', '得分后卫', '小前锋', '大前锋', '中锋'];
const positionCodes = ['', 'PG', 'SG', 'SF', 'PF', 'C'];
const formats = {
  ROUND_ROBIN: '单循环',
  SINGLE_ELIMINATION: '单淘汰',
  GROUP_KNOCKOUT: '分组接淘汰',
};
let viewer = null;
let selection = [];

function validId(value) {
  return typeof value === 'string' && uuidPattern.test(value);
}
function parseIds(value) {
  if (value === undefined || value === '') return [];
  if (typeof value !== 'string' || value.length > 110) throw new Error('球员对比编号无效');
  const ids = value.split(',');
  if (ids.length > 3 || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length)
    throw new Error('只能选择最多3位不同球员');
  return ids;
}
function setViewer(id) {
  if (id !== viewer) selection = [];
  viewer = id;
}
function selectedIds() {
  return selection.slice();
}
function setSelected(ids) {
  if (!Array.isArray(ids) || ids.length > 3 || ids.some((id) => !validId(id)))
    throw new Error('对比球员选择无效');
  selection = Array.from(new Set(ids));
  return selectedIds();
}
function toggle(id) {
  if (!validId(id)) throw new Error('球员编号无效');
  if (selection.includes(id)) selection = selection.filter((old) => old !== id);
  else {
    if (selection.length >= 3) throw new Error('最多比较3位球员，请先移除一位');
    selection.push(id);
  }
  return selectedIds();
}
function syncSelection(players) {
  const live = new Set(players.filter((p) => p.status === 'APPROVED').map((p) => p.id));
  selection = selection.filter((id) => live.has(id));
  return selectedIds();
}
function parseFen(value) {
  const input = String(value === undefined ? '' : value).trim();
  if (!input) return null;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(input)) throw new Error('服务费请输入金额，最多两位小数');
  const pieces = input.split('.');
  const amount = Number(pieces[0]) * 100 + Number((pieces[1] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('服务费金额无效');
  return amount;
}
function dayRange(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('请选择有效日期');
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    throw new Error('请选择有效日期');
  const start = Date.parse(value + 'T00:00:00+08:00');
  return [start, start + 86400000];
}
function filterPlayers(players, filters, anchor) {
  let price;
  let range;
  try {
    price = parseFen(filters.price);
    range = filters.date ? dayRange(filters.date) : null;
  } catch (error) {
    return { players: [], error: error.message };
  }
  if (filters.samePrice && !anchor)
    return { players: [], error: '请先选择一位球员，再按同价同位置筛选' };
  const search = String(filters.search || '')
    .trim()
    .toLowerCase();
  const city = String(filters.city || '')
    .trim()
    .toLowerCase();
  const list = players.filter((p) => {
    if (p.status !== 'APPROVED') return false;
    if (search && !String(p.displayName).toLowerCase().includes(search)) return false;
    if (city && !String(p.city).toLowerCase().includes(city)) return false;
    if (filters.position && p.position !== filters.position) return false;
    if (price !== null && p.priceFen !== price) return false;
    if (filters.samePrice && (p.priceFen !== anchor.priceFen || p.position !== anchor.position))
      return false;
    if (
      range &&
      !p.availability.some(
        (window) => Date.parse(window.startAt) < range[1] && Date.parse(window.endAt) > range[0],
      )
    )
      return false;
    return true;
  });
  if (filters.sort === 'PRICE_ASC') list.sort((a, b) => a.priceFen - b.priceFen);
  if (filters.sort === 'PRICE_DESC') list.sort((a, b) => b.priceFen - a.priceFen);
  return { players: list, error: '' };
}
function fee(fen, bps) {
  return Math.round((fen * bps) / 10000);
}
function money(fen) {
  return '¥' + (fen / 100).toFixed(2);
}
function metric(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.round(value * 10) / 10)
    : '未统计';
}
function performanceView(data, failed) {
  if (!data)
    return {
      status: failed ? '统计读取失败' : '尚无个人统计',
      points: failed ? '暂不可用' : '未统计',
      fouls: failed ? '暂不可用' : '未统计',
      sample: failed ? '暂不可用' : '未统计',
      services: failed ? '暂不可用' : '未统计',
      sourceCount: '未统计',
      source: failed ? '请刷新统计后再比较' : '暂无有效个人统计',
      denominator: '固定名单统计样本不代表实际出场。',
      completeness: failed
        ? '读取失败后不继续展示旧统计，不用0或演示数据补齐。'
        : '缺少统计不代表能力差。',
      records: [],
      truncated: false,
      pending: '未统计',
      invalid: '未统计',
      teamOnly: '未统计',
      partial: '未统计',
      asOf: '',
    };
  const labels = {
    NO_AUTHORIZED_SOURCE: '暂无授权来源',
    NO_PERSONAL_STATS: '尚无个人统计',
    AVAILABLE: '已有个人记录',
    PARTIAL: '部分记录',
  };
  return {
    status: labels[data.dataStatus] || '未统计',
    points: metric(data.pointsPerRecordedMatch),
    fouls: metric(data.foulsPerRecordedMatch),
    sample: metric(data.recordedMatchCount),
    services: metric(data.completedServiceCount),
    sourceCount: metric(data.sourceCount),
    source: data.sourceCount ? '有限双边授权记录' : '暂无有效公开来源',
    denominator: data.denominatorNotice,
    completeness: data.completenessNotice,
    pending: metric(data.pendingMatchCount),
    invalid: metric(data.invalidMatchCount),
    teamOnly: metric(data.teamOnlyMatchCount),
    partial: metric(data.partialAttributionMatchCount),
    truncated: data.truncated === true,
    asOf: data.asOf,
    records: (data.recentRecords || []).slice(0, 5).map((r) => ({
      id: r.recordKey,
      eventName: r.eventName,
      date: String(r.date).slice(0, 10),
      format: formats[r.format] || r.format,
      points: metric(r.points),
      fouls: metric(r.fouls),
      note:
        r.collectionMode === 'TEAM_ONLY'
          ? '仅球队数据，不计入个人均值分母'
          : r.attributionComplete === false
            ? '本队个人归属不完整'
            : '固定名单记录，不代表实际出场',
    })),
  };
}
function profileView(profile, bps, performance, failed) {
  const platformFen = fee(profile.priceFen, bps);
  return {
    id: profile.id,
    name: profile.displayName,
    position: positions[profile.position] || profile.position,
    height: String(profile.heightCm),
    city: profile.city,
    bio: profile.bio,
    priceFen: profile.priceFen,
    price: money(profile.priceFen),
    platformFee: money(platformFen),
    travel: money(profile.travelFen),
    accommodation: money(profile.accommodationFen),
    total: money(profile.priceFen + platformFen + profile.travelFen + profile.accommodationFen),
    performance: performanceView(performance, failed),
    selected: selection.includes(profile.id),
  };
}
function comparisonRows(profiles) {
  const rows = [
    ['price', '参赛服务费'],
    ['platformFee', '平台服务费'],
    ['travel', '交通费'],
    ['accommodation', '食宿费'],
    ['total', '含费预计'],
    ['sample', '个人统计样本'],
    ['points', '每场记录得分'],
    ['fouls', '每场记录犯规'],
    ['services', '完成服务记录'],
    ['status', '记录完整度'],
    ['sourceCount', '授权来源'],
  ];
  return {
    labels: rows.map(([id, label]) => ({ id, label })),
    columns: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      cells: rows.map(([id]) => ({
        id,
        value: Object.prototype.hasOwnProperty.call(p.performance, id) ? p.performance[id] : p[id],
      })),
    })),
  };
}
module.exports = {
  positionOptions,
  positionCodes,
  validId,
  parseIds,
  setViewer,
  selectedIds,
  setSelected,
  toggle,
  syncSelection,
  parseFen,
  dayRange,
  filterPlayers,
  fee,
  metric,
  money,
  performanceView,
  profileView,
  comparisonRows,
};
