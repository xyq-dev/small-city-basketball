function fen(value) {
  const s = String(value || '').trim();
  if (!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(s))
    throw new Error('金额须为不含符号的元数，最多两位小数');
  const [yuan, fraction = ''] = s.split('.');
  const n = Number(yuan) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000000)
    throw new Error('每笔金额须为0.01至1000000.00元');
  return n;
}
function money(value) {
  if (!Number.isSafeInteger(value)) throw new Error('金额资料无效');
  const n = Math.abs(value);
  return (value < 0 ? '-' : '') + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
}
function entry(value) {
  const gov = require('./governance');
  const v = gov.item(value);
  return {
    ...v,
    amountLabel: money(v.amountFen),
    kindLabel:
      { INCOME: '收入记录', EXPENSE: '支出记录', REVERSAL: '冲销原记录' }[v.kind] || '类型待核对',
  };
}
function account(value) {
  const gov = require('./governance');
  const v = gov.item(value);
  if (!Array.isArray(v.entries) || v.entries.length > 1000) throw new Error('账目列表无效');
  const entries = v.entries.map(entry);
  const reversed = new Set(
    entries
      .filter((e) => e.reversesEntryId && ['PENDING_REVIEW', 'APPROVED'].includes(e.status))
      .map((e) => e.reversesEntryId),
  );
  return {
    ...v,
    entries,
    netLabel: money(v.approvedNetFen),
    reversible: entries
      .filter((e) => e.status === 'APPROVED' && e.kind !== 'REVERSAL' && !reversed.has(e.id))
      .map((e) => ({
        ...e,
        pickerLabel: e.occurredOn + ' ' + e.label + ' ' + e.amountLabel + '元',
      })),
  };
}
function snapshot(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > 1000 ||
    !/^[A-Za-z0-9_-]{43}$/.test(raw.publicKey || '')
  )
    throw new Error('公开账目资料无效');
  return {
    ...raw,
    netLabel: money(raw.approvedNetFen),
    entries: raw.entries.map((e) => ({
      ...e,
      amountLabel: money(e.amountFen),
      kindLabel:
        { INCOME: '收入记录', EXPENSE: '支出记录', REVERSAL: '冲销原记录' }[e.kind] || '类型待核对',
    })),
  };
}
module.exports = { fen, money, entry, account, snapshot };
