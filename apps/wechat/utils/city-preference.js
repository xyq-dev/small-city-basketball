const { normalizeCity } = require('./directory');

// A device-level public browsing preference, never a player's address or a region ID.
const KEY = 'scb.browseCity.v1';
const MAX_RECENT = 6;
let fallback;

function clean(raw) {
  if (!raw || raw.version !== 1 || typeof raw.selected !== 'string') return null;
  const selected = normalizeCity(raw.selected);
  if (selected === undefined || typeof raw.chosen !== 'boolean') return null;
  const recent = [];
  if (Array.isArray(raw.recent)) {
    for (const value of raw.recent.slice(0, MAX_RECENT * 2)) {
      if (typeof value !== 'string') continue;
      const city = normalizeCity(value);
      if (city && !recent.includes(city)) recent.push(city);
      if (recent.length === MAX_RECENT) break;
    }
  }
  return { version: 1, selected: selected || '', chosen: raw.chosen, recent };
}

function holder() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) return app.globalData;
  } catch {
    // The public picker also works before an app instance is available.
  }
  if (!fallback) fallback = {};
  return fallback;
}

function state() {
  const host = holder();
  if (!host.scbBrowseCity) {
    let saved;
    try {
      saved = clean(wx.getStorageSync(KEY));
    } catch {
      // Browsing must not depend on persistent storage.
    }
    host.scbBrowseCity = {
      value: saved || { version: 1, selected: '', chosen: false, recent: [] },
      restored: !!saved && saved.chosen,
      persisted: true,
    };
  }
  return host.scbBrowseCity;
}

function snapshot() {
  const current = state();
  return {
    city: current.value.selected,
    label: current.value.selected || '全国',
    source: current.restored ? '上次选择' : current.value.chosen ? '本次选择' : '全国浏览',
    guide: !current.value.chosen,
    recent: current.value.recent.slice(),
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
    // Keep the explicit choice for this app session and report the persistence failure.
  }
  return snapshot();
}

function choose(raw) {
  if (typeof raw !== 'string') throw new Error('请填写城市名称。');
  const city = normalizeCity(raw);
  if (city === undefined) throw new Error('城市仅支持中文、字母、数字、空格和“·”，最多20个字。');
  const current = state().value;
  return save({
    version: 1,
    selected: city || '',
    chosen: true,
    recent: city
      ? [city, ...current.recent.filter((value) => value !== city)].slice(0, MAX_RECENT)
      : current.recent.slice(),
  });
}

function clearRecent() {
  return save({ ...state().value, recent: [] });
}

module.exports = { snapshot, choose, clearRecent };
