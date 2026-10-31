import { govFail, govId, govText } from './governance-domain.js';
import { calendarDate } from './validation.js';
export const OFFLINE_LEDGER_NOTICE =
  '仅记录经授权的线下账目；账面收支差额不是支付余额，不提供募款、钱包或提现。';
export interface LedgerSnapshotSource {
  id: string;
  occurred_on: string;
  label: string;
  kind: string;
  amount_fen: number;
  reverses_entry_id: string | null;
  status: string;
  [key: string]: unknown;
}
/** Explicit public projection. Private account, actor and source identifiers never enter a snapshot. */
export function buildLedgerSnapshot(
  account: { title: string; description: string },
  rows: LedgerSnapshotSource[],
  asOf: string,
) {
  if (!Number.isFinite(Date.parse(asOf)) || rows.length > 1000)
    govFail('LEDGER_SNAPSHOT_INVALID', '公示快照时间或账目数量无效');
  const ids = new Map<string, number>();
  rows.forEach((r, i) => {
    govId(r.id);
    if (
      ids.has(r.id) ||
      r.status !== 'APPROVED' ||
      !Number.isSafeInteger(r.amount_fen) ||
      r.amount_fen === 0 ||
      Math.abs(r.amount_fen) > 100000000
    )
      govFail('LEDGER_SNAPSHOT_INVALID', '公示仅接受无重复且审核通过的有效账目');
    ids.set(r.id, i + 1);
  });
  let approvedNetFen = 0;
  const reversed = new Set<string>();
  const entries = rows.map((r) => {
    let reversesSeq: number | null = null;
    if (r.kind === 'REVERSAL') {
      const target = rows.find((t) => t.id === r.reverses_entry_id);
      if (
        !target ||
        target.kind === 'REVERSAL' ||
        target.amount_fen !== -r.amount_fen ||
        reversed.has(target.id)
      )
        govFail('LEDGER_SNAPSHOT_INVALID', '冲销必须精确对应已公示原账目');
      reversesSeq = ids.get(target.id)!;
      reversed.add(target.id);
    } else if (
      !['INCOME', 'EXPENSE'].includes(r.kind) ||
      r.reverses_entry_id !== null ||
      (r.kind === 'INCOME' ? r.amount_fen < 0 : r.amount_fen > 0)
    )
      govFail('LEDGER_SNAPSHOT_INVALID', '账目符号或类型无效');
    approvedNetFen += r.amount_fen;
    return {
      seq: ids.get(r.id)!,
      occurredOn: calendarDate(r.occurred_on, 'occurredOn'),
      label: govText(r.label, 'label', 1, 200),
      kind: r.kind,
      amountFen: r.amount_fen,
      reversesSeq,
    };
  });
  if (!Number.isSafeInteger(approvedNetFen))
    govFail('LEDGER_SNAPSHOT_INVALID', '账面差额超出精确范围');
  return {
    title: govText(account.title, 'title', 1, 120),
    description: govText(account.description, 'description', 1, 1000),
    asOf: new Date(asOf).toISOString(),
    entries,
    approvedNetFen,
    entryCount: entries.length,
    notice: OFFLINE_LEDGER_NOTICE,
  };
}
