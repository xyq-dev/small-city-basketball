const { normalizeCity } = require('./directory');
const regions = require('./regions');

const KEY = 'scb.browseRegion.v2';
const LEGACY_KEY = 'scb.browseCity.v1';
const MAX_RECENT = 6;
let fallback;
const clone = (value) => JSON.parse(JSON.stringify(value));
function cleanSelection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.mode === 'NATIONWIDE') return { mode: 'NATIONWIDE' };
  if (raw.mode === 'LEGACY_CITY' && typeof raw.city === 'string') {
    const city = normalizeCity(raw.city);
    return city ? { mode: 'LEGACY_CITY', city } : null;
  }
  if (regions.validSelection(raw))
    return {
      mode: 'REGION',
      regionId: raw.regionId,
      catalogVersion: raw.catalogVersion,
      label: raw.label,
      level: raw.level,
    };
  return null;
}
function key(value) {
  return value.mode === 'REGION' ? 'region:' + value.regionId : 'city:' + (value.city || '');
}
function clean(raw) {
  if (!raw || raw.version !== 2 || typeof raw.chosen !== 'boolean') return null;
  const selected = cleanSelection(raw.selected);
  if (!selected) return null;
  const recent = [];
  for (const item of (Array.isArray(raw.recent) ? raw.recent : []).slice(0, MAX_RECENT * 2)) {
    const value = cleanSelection(item);
    if (value && value.mode !== 'NATIONWIDE' && !recent.some((r) => key(r) === key(value)))
      recent.push(value);
    if (recent.length === MAX_RECENT) break;
  }
  return { version: 2, selected, chosen: raw.chosen, recent };
}
function legacy(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    typeof raw.selected !== 'string' ||
    typeof raw.chosen !== 'boolean'
  )
    return null;
  const city = normalizeCity(raw.selected);
  if (city === undefined) return null;
  return clean({
    version: 2,
    selected: city ? { mode: 'LEGACY_CITY', city } : { mode: 'NATIONWIDE' },
    chosen: raw.chosen,
    recent: (Array.isArray(raw.recent) ? raw.recent : [])
      .filter((v) => typeof v === 'string')
      .map((v) => ({ mode: 'LEGACY_CITY', city: v })),
  });
}
function holder() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) return app.globalData;
  } catch {
    /* public preference also works before App exists */
  }
  if (!fallback) fallback = {};
  return fallback;
}
function state() {
  const host = holder();
  if (!host.scbBrowseRegion) {
    let saved;
    try {
      saved = clean(wx.getStorageSync(KEY));
    } catch {
      /* session memory remains usable */
    }
    if (!saved) {
      try {
        saved = legacy(wx.getStorageSync(LEGACY_KEY));
      } catch {
        /* no forced storage dependency */
      }
    }
    host.scbBrowseRegion = {
      value: saved || { version: 2, selected: { mode: 'NATIONWIDE' }, chosen: false, recent: [] },
      restored: !!saved && saved.chosen,
      persisted: true,
    };
  }
  return host.scbBrowseRegion;
}
function label(value) {
  return value.mode === 'REGION' ? value.label : value.mode === 'LEGACY_CITY' ? value.city : '全国';
}
function snapshot() {
  const current = state(),
    selected = current.value.selected;
  return {
    ...clone(selected),
    city: selected.mode === 'LEGACY_CITY' ? selected.city : '',
    label: label(selected),
    description:
      selected.mode === 'REGION'
        ? '本地区及下辖地区'
        : selected.mode === 'LEGACY_CITY'
          ? '历史城市标签精确筛选'
          : '全国公开赛事',
    source: current.restored ? '上次选择' : current.value.chosen ? '本次选择' : '全国浏览',
    guide: !current.value.chosen,
    recent: current.value.recent.filter((r) => r.mode === 'LEGACY_CITY').map((r) => r.city),
    recentChoices: current.value.recent.map((r) => ({ ...clone(r), key: key(r), label: label(r) })),
    warning: current.persisted
      ? ''
      : '更改已在本次生效，但无法保存到本机；下次启动可能恢复之前的城市和最近选择。',
  };
}
function save(value) {
  const current = state();
  current.value = value;
  current.restored = false;
  current.persisted = false;
  try {
    wx.setStorageSync(KEY, value);
    current.persisted = true;
  } catch {
    /* preserve session choice */
  }
  return snapshot();
}
function chooseSelection(raw) {
  const selected = cleanSelection(raw);
  if (!selected) throw new Error('地区选择无效，请重新选择。');
  const current = state().value;
  return save({
    version: 2,
    selected,
    chosen: true,
    recent:
      selected.mode === 'NATIONWIDE'
        ? current.recent.slice()
        : [selected, ...current.recent.filter((r) => key(r) !== key(selected))].slice(
            0,
            MAX_RECENT,
          ),
  });
}
function choose(raw) {
  if (typeof raw !== 'string') throw new Error('请填写城市名称。');
  const city = normalizeCity(raw);
  if (city === undefined) throw new Error('城市仅支持中文、字母、数字、空格和“·”，最多20个字。');
  return chooseSelection(city ? { mode: 'LEGACY_CITY', city } : { mode: 'NATIONWIDE' });
}
function clearRecent() {
  save({ ...state().value, recent: [] });
  try {
    const old = wx.getStorageSync(LEGACY_KEY);
    if (old && old.version === 1) {
      const value = legacy(old);
      if (value)
        wx.setStorageSync(LEGACY_KEY, {
          version: 1,
          selected: value.selected.city || '',
          chosen: value.chosen,
          recent: [],
        });
    }
  } catch {
    state().persisted = false;
  }
  return snapshot();
}
function query(value = snapshot()) {
  return value.mode === 'REGION'
    ? { regionId: value.regionId, catalogVersion: value.catalogVersion }
    : { city: value.city || '' };
}
module.exports = { snapshot, choose, chooseSelection, clearRecent, query };
