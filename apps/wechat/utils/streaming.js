const KEY = 'scb.streamingPending.v1';
const forbidden = /^(?:leaseToken|pushUrl|pullUrl|publishKey|credential)$/i;
function scope(client, org, resource) {
  const actor = client.viewerId && client.viewerId();
  if (typeof actor !== 'string' || !actor) throw Error('请重新登录后操作');
  return actor + ':' + org + ':' + resource;
}
function read() {
  const v = wx.getStorageSync(KEY);
  if (v === '' || v === undefined || v === null) return {};
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('本机未核对操作记录损坏，请联系管理员核对后再操作');
  return v;
}
function put(map) {
  wx.setStorageSync(KEY, map);
  if (JSON.stringify(wx.getStorageSync(KEY)) !== JSON.stringify(map))
    throw Error('本机存储失败，未发送操作');
}
function pending(key) {
  const r = read()[key];
  if (!r) return null;
  if (!r.body || typeof r.body.clientRequestId !== 'string') throw Error('未核对记录无效');
  return r.body;
}
function save(key, body) {
  if (Object.keys(body).some((k) => forbidden.test(k))) throw Error('采集凭据不能保存到设备');
  const map = read();
  if (map[key] && JSON.stringify(map[key].body) !== JSON.stringify(body))
    throw Error('请先核对原操作结果');
  if (!map[key] && Object.keys(map).length >= 20) throw Error('本机未核对记录已满，请先处理原操作');
  map[key] = { body: JSON.parse(JSON.stringify(body)) };
  put(map);
}
function clear(key, id) {
  const map = read();
  if (map[key] && map[key].body.clientRequestId === id) {
    delete map[key];
    put(map);
  }
}
const targetLabels = {
  IDLE: '未启动',
  STARTING: '正在连接',
  CONNECTED: '转推连接已建立',
  FAILED: '连接失败',
  STOPPING: '等待确认停流',
  STOPPED: '已确认停止',
  UNKNOWN: '停止结果未知，仍占用频道',
};
function session(value) {
  if (
    !value ||
    !Array.isArray(value.targets) ||
    !Number.isInteger(value.version) ||
    typeof value.id !== 'string'
  )
    throw Error('直播返回资料无效');
  return {
    ...value,
    targets: value.targets.map((r) => ({ ...r, stateText: targetLabels[r.state] || '状态待核对' })),
  };
}
module.exports = { scope, pending, save, clear, session, targetLabels };
