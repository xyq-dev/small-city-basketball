const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
const statusLabels = {
  PENDING: '资料等待审核',
  APPROVED: '入驻资料已审核',
  REJECTED: '资料需要修改',
  DISABLED: '服务档案已停用',
};
function fen(value, field, minimum = 0) {
  const input = String(value == null ? '' : value).trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(input)) throw new Error(field + '请填写最多两位小数的金额');
  const [whole, fraction = ''] = input.split('.');
  const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(result) || result < minimum || result > 10000000)
    throw new Error(field + '超出允许范围');
  return result;
}
function moneyInput(value) {
  return (Number(value || 0) / 100).toFixed(2);
}
function chinaParts(value) {
  const date = new Date(Date.parse(value) + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  const result = date.toISOString();
  return { date: result.slice(0, 10), time: result.slice(11, 16) };
}
function formFromProfile(profile) {
  return {
    displayName: profile ? profile.displayName : '',
    position: profile ? profile.position : 'PG',
    heightCm: profile ? String(profile.heightCm) : '',
    city: profile ? profile.city : '',
    bio: profile ? profile.bio : '',
    price: profile ? moneyInput(profile.priceFen) : '',
    travel: profile ? moneyInput(profile.travelFen) : '0.00',
    accommodation: profile ? moneyInput(profile.accommodationFen) : '0.00',
    adultConfirmed: false,
    availability: profile
      ? profile.availability.map((w, index) => {
          const start = chinaParts(w.startAt),
            end = chinaParts(w.endAt);
          return {
            key: 'saved-' + index,
            startDate: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
          };
        })
      : [],
  };
}
function text(value, field, min, max) {
  const result = String(value || '').trim();
  if (result.length < min || result.length > max)
    throw new Error(field + '请填写' + min + '至' + max + '个字符');
  return result;
}
function stamp(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time)))
    throw new Error('请选择完整日期和时间');
  const iso = new Date(date + 'T' + time + ':00+08:00');
  if (!Number.isFinite(iso.getTime())) throw new Error('可约日期或时间无效');
  const round = chinaParts(iso.toISOString());
  if (round.date !== date || round.time !== time) throw new Error('可约日期或时间无效');
  return iso.toISOString();
}
function windows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 60)
    throw new Error('请填写1至60个可约时间段');
  const result = rows
    .map((w) => {
      const startAt = stamp(w.startDate, w.startTime),
        endAt = stamp(w.endDate, w.endTime);
      if (startAt >= endAt || Date.parse(endAt) - Date.parse(startAt) > 31 * 86400000)
        throw new Error('可约时段结束须晚于开始，单段最多31天');
      return { startAt, endAt };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (result.some((w, i) => i > 0 && w.startAt < result[i - 1].endAt))
    throw new Error('可约时间段不能重叠');
  return result;
}
function profileInput(form, expectedVersion, commandId) {
  if (form.adultConfirmed !== true) throw new Error('请由本人明确确认已成年及资料真实性');
  if (!positions.includes(form.position)) throw new Error('请选择有效位置');
  const height = Number(form.heightCm);
  if (
    !/^\d{3}$/.test(String(form.heightCm)) ||
    !Number.isInteger(height) ||
    height < 120 ||
    height > 250
  )
    throw new Error('身高请填写120至250厘米');
  return {
    commandId,
    expectedVersion,
    displayName: text(form.displayName, '姓名', 1, 40),
    position: form.position,
    heightCm: height,
    city: text(form.city, '服务地区', 1, 60),
    bio: text(form.bio, '服务介绍', 0, 500),
    priceFen: fen(form.price, '参赛服务费', 1),
    travelFen: fen(form.travel, '交通费'),
    accommodationFen: fen(form.accommodation, '食宿费'),
    availability: windows(form.availability),
    adultConfirmed: true,
  };
}
function quote(form, feeBps) {
  try {
    const service = fen(form.price, '参赛服务费', 1);
    const travel = fen(form.travel, '交通费'),
      accommodation = fen(form.accommodation, '食宿费');
    const platform = Math.round((service * feeBps) / 10000);
    return {
      service,
      travel,
      accommodation,
      platform,
      total: service + travel + accommodation + platform,
    };
  } catch {
    return null;
  }
}
module.exports = {
  positions,
  statusLabels,
  fen,
  chinaParts,
  formFromProfile,
  stamp,
  windows,
  profileInput,
  quote,
};
