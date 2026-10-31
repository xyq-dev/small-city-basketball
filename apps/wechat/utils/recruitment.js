const api = require('./api');
function base(org, event) {
  return '/v1/orgs/' + api.uuid(org) + '/events/' + api.uuid(event);
}
function publicPath(id) {
  return '/v1/public/recruitments/' + api.publicId(id);
}
function parseTeams(text) {
  if (typeof text !== 'string' || text.length > 24000) throw new Error('导入内容过长');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines.length > 32) throw new Error('每批填写1至32行，空行也会定位错误');
  return lines.map((line, n) => {
    const fields = line.split('\t');
    if (fields.length > 3) throw new Error('第' + (n + 1) + '行超过3列');
    return {
      teamName: fields[0] || '',
      teamId: fields[1]?.trim() || null,
      leaderUserId: fields[2]?.trim() || null,
    };
  });
}
function page(value) {
  if (
    !value ||
    !Array.isArray(value.items) ||
    value.items.length > 100 ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string')
  )
    throw new Error('列表资料无效');
  return value;
}
function get(path) {
  return api
    .getClient()
    .request(path)
    .then((r) => r.data);
}
function listing(path, cursor) {
  return get(path + '?limit=25' + (cursor ? '&before=' + encodeURIComponent(cursor) : '')).then(
    page,
  );
}
module.exports = { base, publicPath, parseTeams, get, listing };
