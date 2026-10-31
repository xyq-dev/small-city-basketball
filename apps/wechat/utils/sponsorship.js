const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  VERSION = /^[a-z0-9][a-z0-9-]{0,63}$/,
  KEY = /^[A-Za-z0-9_-]{43}$/;
function card(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !KEY.test(raw.publicKey || '') ||
    raw.label !== '广告／赞助' ||
    raw.measurement !== 'CLIENT_REPORTED_DEDUPLICATED' ||
    !raw.region ||
    !ID.test(raw.region.regionId || '') ||
    !VERSION.test(raw.region.catalogVersion || '') ||
    !['brand', 'title', 'body'].every((k) => typeof raw[k] === 'string' && raw[k].trim()) ||
    raw.brand.length > 80 ||
    raw.title.length > 120 ||
    raw.body.length > 1000 ||
    !Number.isFinite(Date.parse(raw.startsAt)) ||
    !Number.isFinite(Date.parse(raw.endsAt)) ||
    !Number.isFinite(Date.parse(raw.serverTime)) ||
    Date.parse(raw.startsAt) >= Date.parse(raw.endsAt)
  )
    throw new Error('投放资料或时间格式无效');
  return {
    publicKey: raw.publicKey,
    label: raw.label,
    brand: raw.brand,
    title: raw.title,
    body: raw.body,
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    serverTime: raw.serverTime,
    region: { catalogVersion: raw.region.catalogVersion, regionId: raw.region.regionId },
    measurement: raw.measurement,
  };
}
// The whole request duration is subtracted conservatively; the device never grants extra time.
function remaining(value, requestedAt, receivedAt) {
  const start = Date.parse(value.startsAt),
    end = Date.parse(value.endsAt),
    server = Date.parse(value.serverTime);
  if (
    ![start, end, server, requestedAt, receivedAt].every(Number.isFinite) ||
    receivedAt < requestedAt ||
    server < start ||
    server >= end
  )
    throw new Error('投放尚未开始、已结束或当前时间无法核对');
  const budget = end - server - (receivedAt - requestedAt);
  if (budget <= 0) throw new Error('投放时段已结束');
  return budget;
}
module.exports = { card, remaining };
