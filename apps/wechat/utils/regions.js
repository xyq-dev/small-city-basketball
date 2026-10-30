const api = require('./api');

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LEVELS = ['PROVINCE', 'PREFECTURE', 'COUNTY'];
function exact(value, fields) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === fields.slice().sort().join(',')
  );
}
function validate(raw) {
  const bad = () => {
    throw new Error('地区目录资料无效，请重新读取。');
  };
  if (
    !exact(raw, ['catalogVersion', 'dataDate', 'partialRootIds', 'regions']) ||
    typeof raw.catalogVersion !== 'string' ||
    !VERSION.test(raw.catalogVersion) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.dataDate) ||
    !Array.isArray(raw.regions) ||
    !raw.regions.length ||
    raw.regions.length > 10000 ||
    !Array.isArray(raw.partialRootIds)
  )
    bad();
  const index = Object.create(null);
  const nodes = raw.regions.map((r) => {
    if (
      !exact(r, ['id', 'parentId', 'name', 'level']) ||
      !ID.test(r.id) ||
      index[r.id] ||
      !(r.parentId === null || ID.test(r.parentId)) ||
      !LEVELS.includes(r.level) ||
      typeof r.name !== 'string' ||
      !r.name.trim() ||
      r.name.length > 80
    )
      bad();
    const node = { id: r.id, parentId: r.parentId, name: r.name, level: r.level };
    index[r.id] = node;
    return node;
  });
  if (new Set(raw.partialRootIds).size !== raw.partialRootIds.length) bad();
  for (const id of raw.partialRootIds)
    if (!ID.test(id) || !index[id] || index[id].level !== 'PROVINCE') bad();
  const parents = new Set(nodes.map((node) => node.parentId));
  for (const node of nodes) {
    const path = [];
    let current = node;
    while (current) {
      path.unshift(current.name);
      if (path.length > 3) bad();
      if (current.parentId === null) {
        if (current.level !== 'PROVINCE') bad();
        node.partial = raw.partialRootIds.includes(current.id);
        break;
      }
      const parent = index[current.parentId];
      if (!parent || LEVELS.indexOf(parent.level) >= LEVELS.indexOf(current.level)) bad();
      current = parent;
    }
    node.path = path.join(' / ');
    node.hasChildren = parents.has(node.id);
  }
  return { version: raw.catalogVersion, dataDate: raw.dataDate, nodes, index };
}
async function fetchCatalog(client = api.getClient()) {
  const response = await client.requestPublic('/v1/public/regions');
  return validate(response.data);
}
function selection(catalog, id) {
  const node = catalog && catalog.index[id];
  if (!node) throw new Error('请从有效地区目录重新选择。');
  return {
    mode: 'REGION',
    regionId: node.id,
    catalogVersion: catalog.version,
    label: node.path,
    level: node.level,
  };
}
function validSelection(value) {
  return (
    value &&
    value.mode === 'REGION' &&
    ID.test(value.regionId) &&
    typeof value.catalogVersion === 'string' &&
    VERSION.test(value.catalogVersion) &&
    typeof value.label === 'string' &&
    value.label.length > 0 &&
    value.label.length <= 250 &&
    LEVELS.includes(value.level)
  );
}
function failure(error) {
  if (error && (error.code === 'INVALID_PATH' || error.status === 404))
    return '地区服务尚未升级，请稍后重试；仍可浏览全国或按历史城市文字筛选。';
  if (error && error.status === 429) return '地区目录读取过于频繁，请稍后重试。';
  return (error && error.message) || '地区目录暂时无法读取，请重试。';
}
module.exports = { fetchCatalog, validate, selection, validSelection, failure };
