// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicScheduleMatchData } from '@small-city-basketball/contracts';
import {
  csvCell,
  downloadPublicExport,
  matchCsv,
  matchPoster,
  POSTER_PAGE_SIZE,
  safeExportFilename,
  scheduleCsv,
  schedulePoster,
  xmlText,
} from './exports';
import { live, publicEvent, publicMatch, time, unprepared } from './test-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function schedule(count: number): PublicScheduleMatchData[] {
  return Array.from({ length: count }, (_, index) => ({
    ...publicMatch,
    publicMatchId: `public-match-${index}`,
    positionNo: index + 1,
    home: { ...publicMatch.home, teamName: `主队${index + 1}` },
  }));
}
describe('public export security and completeness', () => {
  it.each(['=1+1', ' +cmd', '\t@SUM(1)', '\r-1+2', '\u200b=HYPERLINK("x")', '\ufeff=1'])(
    'quotes and neutralizes spreadsheet formula prefix %j',
    (input) => {
      expect(csvCell(input).startsWith('"\'')).toBe(true);
    },
  );
  it('quotes separators and embedded quotes without turning normal text into formulas', () => {
    expect(csvCell('城市,"篮球"')).toBe('"城市,""篮球"""');
    expect(csvCell(0)).toBe('"0"');
  });
  it('XML text cannot create elements, attributes, external references or invalid control text', () => {
    const malicious = '<script href="https://invalid.test">&\u0000"\'</script>';
    const xml = `<svg xmlns="http://www.w3.org/2000/svg"><text>${xmlText(malicious)}</text></svg>`;
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    expect(parsed.querySelector('script')).toBeNull();
    expect(parsed.querySelector('text')?.textContent).toBe(malicious.replace('\u0000', ''));
    expect(parsed.querySelector('[href]')).toBeNull();
  });
  it('filenames cannot contain path separators, reserved characters, controls or leading dots', () => {
    const result = safeExportFilename('../../目录\\恶意:队名\u0000?*<>|');
    expect(result).not.toMatch(/[\\/:\u0000?*<>|]/);
    expect(result.startsWith('.')).toBe(false);
    expect(safeExportFilename(' . ')).toBe('小城市篮球');
  });
  it('requires all published matches and rejects duplicates rather than exporting partial data', () => {
    expect(() => scheduleCsv({ ...publicEvent, totalMatchCount: 2 }, [publicMatch], time)).toThrow(
      '完整公开赛程',
    );
    expect(() =>
      schedulePoster({ ...publicEvent, totalMatchCount: 2 }, [publicMatch, publicMatch], 1, time),
    ).toThrow('完整公开赛程');
    expect(() => scheduleCsv({ ...publicEvent, totalMatchCount: 0 }, [], time)).toThrow(
      '完整公开赛程',
    );
  });
  it('projects only display fields without exporting public/private identifiers or source URLs', () => {
    const event = {
      ...publicEvent,
      organizationId: 'private-org-sentinel',
      token: 'secret-sentinel',
    };
    const match = { ...publicMatch, privateId: 'private-match-sentinel' };
    const assets = [scheduleCsv(event, [match], time), schedulePoster(event, [match], 1, time)];
    for (const asset of assets) {
      expect(asset.body).toContain(publicEvent.name);
      for (const value of [
        publicEvent.publicEventId,
        publicMatch.publicMatchId,
        publicMatch.home.teamKey,
        'private-org-sentinel',
        'private-match-sentinel',
        'secret-sentinel',
      ])
        expect(asset.body).not.toContain(value);
      expect(asset.body).not.toContain('/watch/');
    }
  });
});
describe('public snapshot presentation', () => {
  it('keeps two-line long team names clear of the time line, card edges and the next card', () => {
    const matches = schedule(2).map((match) => ({
      ...match,
      home: { ...match.home, teamName: 'ABCDEFGHIJKLMNOPQRSTUV WXYZABCDEF Long Team' },
      away: { ...match.away, teamName: 'SecondVeryLongBasketballTeamNameWithTwoLines' },
    }));
    const asset = schedulePoster({ ...publicEvent, totalMatchCount: 2 }, matches, 1, time);
    const document = new DOMParser().parseFromString(asset.body, 'image/svg+xml');
    const cards = Array.from(document.querySelectorAll('rect[x="32"]'));
    expect(cards).toHaveLength(2);
    const texts = Array.from(document.querySelectorAll('text'));
    for (const [index, card] of cards.entries()) {
      const top = Number(card.getAttribute('y'));
      const bottom = top + Number(card.getAttribute('height'));
      const names = texts.filter(
        (text) =>
          text.getAttribute('font-size') === '28' &&
          Number(text.getAttribute('y')) > top &&
          Number(text.getAttribute('y')) < bottom,
      );
      expect(names).toHaveLength(4);
      const lastNameBottom = Math.max(
        ...names.map((text) => Number(text.getAttribute('y')) + 28 * 0.3),
      );
      const timing = texts.find(
        (text) =>
          text.getAttribute('font-size') === '19' &&
          Number(text.getAttribute('y')) > top &&
          Number(text.getAttribute('y')) < bottom,
      )!;
      // Reserve a full em above the baseline and 0.3em for descenders; this
      // catches overlap independently of whether the test machine has CJK fonts.
      const timingTop = Number(timing.getAttribute('y')) - 19;
      const timingBottom = Number(timing.getAttribute('y')) + 19 * 0.3;
      expect(timingTop - lastNameBottom).toBeGreaterThanOrEqual(10);
      expect(bottom - timingBottom).toBeGreaterThanOrEqual(8);
      const next = cards[index + 1];
      if (next) expect(Number(next.getAttribute('y')) - bottom).toBeGreaterThanOrEqual(12);
    }
  });
  it('paginates schedule posters honestly and CSV still includes every match', () => {
    const matches = schedule(POSTER_PAGE_SIZE + 1);
    const event = { ...publicEvent, totalMatchCount: matches.length };
    const first = schedulePoster(event, matches, 1, time);
    const last = schedulePoster(event, matches, 2, time);
    expect(first.body).toContain('本页 8 场 / 全部 9 场');
    expect(first.body).not.toContain('主队9');
    expect(last.body).toContain('本页 1 场 / 全部 9 场');
    expect(last.body).toContain('主队9');
    expect(scheduleCsv(event, matches, time).body).toContain('主队9');
    expect(() => schedulePoster(event, matches, 3, time)).toThrow('页码');
  });
  it('distinguishes uncollected scores from actual zero and preserves result status', () => {
    const none = matchPoster(unprepared, time);
    expect(none.body).toContain('比分尚未采集');
    expect(matchCsv(unprepared, time).body).toContain('"主队得分","未采集"');
    const prepared = {
      ...live,
      score: { home: 0, away: 0 },
      resultStatus: 'REQUIRES_RECONFIRMATION' as const,
    };
    expect(matchCsv(prepared, time).body).toContain('"主队得分","0"');
    expect(matchPoster(prepared, time).body).toContain('待重新确认赛果');
    expect(matchCsv(prepared, time).body).toContain('未统计');
  });
  it('uses the authoritative clock anchor once and marks the generated timer as a static snapshot', () => {
    expect(matchPoster(live, time).body).toContain('剩余 00:50');
    expect(matchCsv(live, time).body).toContain('"剩余时间（静态快照）","00:50"');
    expect(matchPoster(live, time).body).toContain('生成时间');
    expect(matchPoster(live, time).body).toContain('数据时间');
    expect(live.clock?.remainingMs).toBe(60000);
  });
  it('downloads a local Blob, removes its temporary link, and releases the URL after the browser handshake', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:test-export');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download.endsWith('.csv')).toBe(true);
      expect(this.href).toBe('blob:test-export');
    });
    downloadPublicExport(scheduleCsv(publicEvent, [publicMatch], time));
    expect(clicked).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-export');
  });
});
