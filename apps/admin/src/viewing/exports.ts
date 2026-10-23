import type {
  PublicEventData,
  PublicMatchSnapshotData,
  PublicScheduleMatchData,
} from '@small-city-basketball/contracts';
import { clockLabel, clockRemaining } from '../scoring/clock';

export const POSTER_PAGE_SIZE = 8;
export interface PublicExportFile {
  filename: string;
  mediaType: string;
  body: string;
}
export const exportStatus: Record<PublicScheduleMatchData['status'], string> = {
  SCHEDULED: '尚未准备',
  READY: '已准备，尚未开赛',
  LIVE: '比赛进行中',
  PENDING_CONFIRMATION: '待确认赛果',
  FINAL: '正式赛果',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};
const resultLabels = {
  UNCONFIRMED: '赛果未确认',
  CONFIRMED: '赛果已确认',
  REQUIRES_RECONFIRMATION: '待重新确认赛果',
};
function clean(value: string) {
  return Array.from(value)
    .filter((character) => {
      const point = character.codePointAt(0)!;
      return (
        point >= 32 &&
        point !== 127 &&
        !(point >= 0xd800 && point <= 0xdfff) &&
        point !== 0xfffe &&
        point !== 0xffff
      );
    })
    .join('');
}
export function xmlText(value: string) {
  return clean(value).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!;
  });
}
export function safeExportFilename(value: string) {
  const name = clean(value)
    .replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  return Array.from(name).slice(0, 64).join('') || '小城市篮球';
}
export function csvCell(value: string | number) {
  let safe = clean(String(value));
  if (/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}
function csv(rows: (string | number)[][]) {
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function timestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('导出时间无效，请重新读取资料。');
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
function score(match: PublicScheduleMatchData) {
  return match.score ? `${match.score.home} : ${match.score.away}` : '未采集';
}
function status(match: PublicScheduleMatchData) {
  return `${exportStatus[match.status]} · ${resultLabels[match.resultStatus]}`;
}
function checkSchedule(event: PublicEventData, matches: PublicScheduleMatchData[]) {
  if (
    matches.length !== event.totalMatchCount ||
    matches.length === 0 ||
    new Set(matches.map((match) => match.publicMatchId)).size !== matches.length
  )
    throw new Error('完整公开赛程尚未读取成功，请刷新后再导出。');
}
function file(name: string, extension: 'csv' | 'svg', body: string): PublicExportFile {
  return {
    filename: `${safeExportFilename(name)}.${extension}`,
    mediaType: extension === 'csv' ? 'text/csv;charset=utf-8' : 'image/svg+xml;charset=utf-8',
    body,
  };
}
export function scheduleCsv(
  event: PublicEventData,
  matches: PublicScheduleMatchData[],
  generatedAt: string,
) {
  checkSchedule(event, matches);
  const rows: (string | number)[][] = [
    [
      '赛事',
      '轮次',
      '场次',
      '开赛时间（中国标准时间）',
      '结束时间（中国标准时间）',
      '场地',
      '主队',
      '客队',
      '主队得分',
      '客队得分',
      '比赛状态',
      '赛果状态',
      '统计说明',
      '数据时间（中国标准时间）',
      '生成时间（中国标准时间）',
    ],
    ...matches.map((match) => [
      event.name,
      match.roundNo,
      match.positionNo,
      timestamp(match.startsAt),
      timestamp(match.endsAt),
      match.courtName,
      match.home.teamName,
      match.away.teamName,
      match.score?.home ?? '',
      match.score?.away ?? '',
      exportStatus[match.status],
      resultLabels[match.resultStatus],
      match.score ? '球队比分静态快照；球员专业统计未统计' : '比分尚未采集',
      timestamp(event.serverTime),
      timestamp(generatedAt),
    ]),
  ];
  return file(`${event.name}-公开赛程`, 'csv', csv(rows));
}
export function matchCsv(match: PublicMatchSnapshotData, generatedAt: string) {
  const clock = match.clock
    ? clockLabel(clockRemaining(match.clock, match.serverTime, 0))
    : '未采集';
  return file(
    `${match.eventName}-${match.home.teamName}对${match.away.teamName}-比分`,
    'csv',
    csv([
      ['项目', '内容'],
      ['赛事', match.eventName],
      ['轮次', match.roundNo],
      ['场地', match.courtName],
      ['开赛时间（中国标准时间）', timestamp(match.startsAt)],
      ['主队', match.home.teamName],
      ['客队', match.away.teamName],
      ['主队得分', match.score?.home ?? '未采集'],
      ['客队得分', match.score?.away ?? '未采集'],
      ['比赛状态', exportStatus[match.status]],
      ['赛果状态', resultLabels[match.resultStatus]],
      ['节次', match.clock?.period ?? '未采集'],
      ['剩余时间（静态快照）', clock],
      ['时钟状态', match.clock ? (match.clock.running ? '运行中' : '已暂停') : '未采集'],
      ['主队犯规', match.totals?.home.fouls ?? '未采集'],
      ['客队犯规', match.totals?.away.fouls ?? '未采集'],
      ['主队暂停', match.totals?.home.timeouts ?? '未采集'],
      ['客队暂停', match.totals?.away.timeouts ?? '未采集'],
      ['球员专业统计', '未统计'],
      ['数据时间（中国标准时间）', timestamp(match.serverTime)],
      ['生成时间（中国标准时间）', timestamp(generatedAt)],
    ]),
  );
}
function text(
  value: string,
  x: number,
  y: number,
  size: number,
  color = '#132c49',
  weight = 400,
  anchor = 'start',
) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${xmlText(value)}</text>`;
}
function lines(value: string, maxWidth: number, limit = 2) {
  const result: string[] = [];
  let current = '',
    width = 0;
  for (const character of clean(value)) {
    const next = /[\x20-\x7e]/.test(character) ? 0.6 : 1;
    if (width + next > maxWidth) {
      result.push(current);
      current = '';
      width = 0;
      if (result.length === limit) {
        result[limit - 1] = result[limit - 1].slice(0, -1) + '…';
        return result;
      }
    }
    current += character;
    width += next;
  }
  if (current) result.push(current);
  return result;
}
function title(value: string, x: number, y: number, size: number, width: number, anchor = 'start') {
  return lines(value, width)
    .map((line, index) => text(line, x, y + index * (size + 7), size, '#132c49', 700, anchor))
    .join('');
}
function svg(height: number, label: string, content: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}" role="img" aria-label="${xmlText(label)}"><rect width="1080" height="${height}" fill="#f5f7fb"/><g font-family="Noto Sans SC,PingFang SC,Microsoft YaHei,sans-serif">${content}</g></svg>`;
}
function footer(generatedAt: string, serverTime: string, y: number) {
  return (
    text(`数据时间 ${timestamp(serverTime)} · 中国标准时间`, 48, y, 20, '#53677d') +
    text(
      `生成时间 ${timestamp(generatedAt)} · 静态快照，以最新公开资料为准`,
      48,
      y + 34,
      20,
      '#53677d',
    )
  );
}
export function schedulePoster(
  event: PublicEventData,
  matches: PublicScheduleMatchData[],
  page: number,
  generatedAt: string,
) {
  checkSchedule(event, matches);
  const pageCount = Math.ceil(matches.length / POSTER_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1 || page > pageCount)
    throw new Error('赛程已变化，请重新选择海报页码。');
  const selection = matches.slice((page - 1) * POSTER_PAGE_SIZE, page * POSTER_PAGE_SIZE);
  const height = 330 + selection.length * 188;
  let content =
    text('小城市篮球 · SMALL CITY. BIG HOME COURT.', 48, 50, 22, '#53677d') +
    title(event.name, 48, 110, 38, 25) +
    text(
      `公开赛程 · 第 ${page} / ${pageCount} 页 · 本页 ${selection.length} 场 / 全部 ${matches.length} 场`,
      48,
      214,
      24,
    );
  selection.forEach((match, index) => {
    const top = 246 + index * 188;
    content += `<rect x="32" y="${top}" width="1016" height="170" rx="16" fill="#ffffff"/>`;
    content += text(`第${match.roundNo}轮 · 第${match.positionNo}场`, 54, top + 30, 21, '#53677d');
    content += text(status(match), 1022, top + 30, 20, '#53677d', 400, 'end');
    content += title(match.home.teamName, 54, top + 78, 28, 13);
    content += text(match.score ? score(match) : 'VS', 540, top + 84, 34, '#eb5b22', 700, 'middle');
    content += title(match.away.teamName, 1022, top + 78, 28, 13, 'end');
    content += text(
      lines(`${timestamp(match.startsAt)} · ${clean(match.courtName)}`, 49, 1)[0],
      54,
      top + 151,
      19,
      '#53677d',
    );
  });
  content += footer(generatedAt, event.serverTime, height - 48);
  return file(
    `${event.name}-赛程海报-${page}`,
    'svg',
    svg(height, `${event.name}公开赛程第${page}页`, content),
  );
}
export function matchPoster(match: PublicMatchSnapshotData, generatedAt: string) {
  let content =
    text('小城市篮球 · SMALL CITY. BIG HOME COURT.', 48, 56, 23, '#53677d') +
    title(match.eventName, 48, 128, 40, 23) +
    text(status(match), 48, 254, 26, '#53677d') +
    `<rect x="32" y="300" width="1016" height="470" rx="28" fill="#ffffff"/>` +
    text('主队 · HOME', 280, 350, 24, '#53677d', 400, 'middle') +
    text('客队 · AWAY', 800, 350, 24, '#53677d', 400, 'middle') +
    title(match.home.teamName, 280, 425, 38, 12, 'middle') +
    title(match.away.teamName, 800, 425, 38, 12, 'middle') +
    text(match.score ? String(match.score.home) : '—', 280, 622, 110, '#eb5b22', 700, 'middle') +
    text(':', 540, 612, 72, '#53677d', 400, 'middle') +
    text(match.score ? String(match.score.away) : '—', 800, 622, 110, '#eb5b22', 700, 'middle') +
    text(
      match.score ? resultLabels[match.resultStatus] : '比分尚未采集',
      540,
      718,
      28,
      '#53677d',
      400,
      'middle',
    );
  content += text(`第${match.roundNo}轮 · ${timestamp(match.startsAt)}`, 48, 838, 26);
  content += title(match.courtName, 48, 894, 30, 30);
  content += text(
    match.clock
      ? `第${match.clock.period}节 · 剩余 ${clockLabel(clockRemaining(match.clock, match.serverTime, 0))} · ${match.clock.running ? '运行中' : '已暂停'}`
      : '时钟尚未采集',
    48,
    1012,
    28,
  );
  content += text('球队比分与时钟为静态快照；球员专业统计未统计。', 48, 1080, 24, '#53677d');
  content += footer(generatedAt, match.serverTime, 1190);
  return file(
    `${match.eventName}-${match.home.teamName}对${match.away.teamName}-比分海报`,
    'svg',
    svg(1280, `${match.eventName}比赛比分`, content),
  );
}
export function downloadPublicExport(asset: PublicExportFile) {
  const url = URL.createObjectURL(new Blob([asset.body], { type: asset.mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = asset.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
