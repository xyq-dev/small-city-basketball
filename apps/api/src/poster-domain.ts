import { ApiError } from './errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { invalid, objectInput, resourceId } from './validation.js';
import { requestId, versionInput } from './recruitment-domain.js';

export const POSTER_RENDERER_VERSION = 'X05_POSTER_V1';
export const POSTER_WIDTH = 1080;
export const POSTER_MAX_BYTES = 8 * 1024 * 1024;
export type PosterKind = 'ROSTER' | 'MATCHUP' | 'RESULT' | 'HONOR';
export interface PosterInput {
  clientRequestId: string;
  expectedEventVersion: number;
  kind: PosterKind;
  entryId: string | null;
  matchId: string | null;
  memberIds: string[];
  includePortraits: boolean;
}
export interface PosterRecipe {
  rendererVersion: typeof POSTER_RENDERER_VERSION;
  kind: PosterKind;
  eventName: string;
  dateLabel: string;
  venueName: string | null;
  headline: string;
  subtitle: string;
  teams: string[];
  score: string | null;
  lines: string[];
  players: {
    memberId: string;
    name: string;
    jerseyNo: string;
    materialId: string;
    revisionId: string;
    materialVersion: number;
    portraitHash: string;
    includePortrait: boolean;
  }[];
  omittedPlayerCount: number;
  publicationId: string;
  proof: unknown;
}
export function parsePosterInput(raw: unknown): PosterInput {
  const i = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'kind',
    'entryId',
    'matchId',
    'memberIds',
    'includePortraits',
  ]);
  if (!['ROSTER', 'MATCHUP', 'RESULT', 'HONOR'].includes(i.kind as string))
    invalid('请选择阵容、对阵、战报或荣誉海报');
  if (i.includePortraits !== undefined && typeof i.includePortraits !== 'boolean')
    invalid('请明确选择是否使用授权照片');
  const kind = i.kind as PosterKind;
  const entryId = i.entryId == null ? null : resourceId(i.entryId as string),
    matchId = i.matchId == null ? null : resourceId(i.matchId as string);
  const memberIds = i.memberIds === undefined ? [] : i.memberIds;
  if (!Array.isArray(memberIds) || memberIds.length > 60) invalid('每张阵容海报最多60人');
  const ids = memberIds.map((x) => resourceId(x as string));
  if (new Set(ids).size !== ids.length) invalid('海报队员不能重复');
  if (
    (kind === 'ROSTER' && (!entryId || matchId)) ||
    (kind !== 'ROSTER' && (entryId || ids.length)) ||
    (['MATCHUP', 'RESULT'].includes(kind) ? !matchId : kind === 'HONOR' && matchId !== null)
  )
    invalid('海报类型与所选球队／比赛不一致');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedEventVersion: versionInput(i.expectedEventVersion),
    kind,
    entryId,
    matchId,
    memberIds: ids.sort(),
    includePortraits: i.includePortraits !== false,
  };
}
export function posterDimensions(
  recipe: Pick<PosterRecipe, 'players'> & Partial<Pick<PosterRecipe, 'kind' | 'lines'>>,
) {
  return {
    width: POSTER_WIDTH,
    height: Math.max(
      1440,
      680 + Math.ceil(recipe.players.length / 5) * 210,
      recipe.kind === 'HONOR' ? 760 + Math.min(recipe.lines?.length || 0, 32) * 48 : 0,
    ),
  };
}
export function escapePosterText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function label(value: string, limit: number) {
  const chars = Array.from(value);
  return escapePosterText(chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : value);
}
/** Pure recipe-to-SVG: only our shapes/text and re-encoded JPEG thumbnails, never user HTML/URLs. */
export function posterSvg(
  recipe: PosterRecipe,
  thumbnails: ReadonlyMap<string, string> = new Map(),
): string {
  const { width, height } = posterDimensions(recipe);
  const text = (
    x: number,
    y: number,
    value: string,
    size = 36,
    color = '#ffffff',
    anchor = 'start',
  ) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}" font-family="sans-serif">${value}</text>`;
  const chunks = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#123c73"/><rect x="0" y="0" width="${width}" height="18" fill="#f28c28"/>`,
    text(64, 92, '小城市篮球', 38, '#f7b266'),
    text(64, 170, label(recipe.eventName, 28), 46),
    text(64, 262, label(recipe.headline, 25), 64),
    text(64, 318, label(recipe.subtitle, 42), 28, '#cedcec'),
  ];
  if (recipe.kind === 'ROSTER') {
    if (!recipe.players.length)
      chunks.push(text(540, 600, '本版未使用个人姓名或照片', 38, '#ffffff', 'middle'));
    recipe.players.forEach((p, n) => {
      const x = 52 + (n % 5) * 198,
        y = 380 + Math.floor(n / 5) * 210,
        image = thumbnails.get(p.memberId);
      chunks.push(`<rect x="${x}" y="${y}" width="184" height="194" rx="12" fill="#224f88"/>`);
      if (image) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image))
          throw new ApiError(503, 'POSTER_RENDER_FAILED', '海报素材无法读取');
        chunks.push(
          `<image x="${x + 27}" y="${y + 10}" width="130" height="130" href="data:image/jpeg;base64,${image}"/>`,
        );
      } else chunks.push(text(x + 92, y + 94, label('#' + p.jerseyNo, 5), 56, '#f7b266', 'middle'));
      chunks.push(text(x + 92, y + 176, label(p.name, 9), 25, '#ffffff', 'middle'));
    });
  } else if (recipe.kind === 'HONOR') {
    recipe.lines
      .slice(0, 32)
      .forEach((line, n) =>
        chunks.push(
          text(88, 438 + n * 48, label(line, 34), n < 3 ? 38 : 28, n < 3 ? '#f7b266' : '#ffffff'),
        ),
      );
  } else {
    chunks.push(
      text(540, 490, label(recipe.teams[0] || '', 22), 50, '#ffffff', 'middle'),
      text(
        540,
        640,
        recipe.score ? escapePosterText(recipe.score) : 'VS',
        112,
        '#f7b266',
        'middle',
      ),
      text(540, 790, label(recipe.teams[1] || '', 22), 50, '#ffffff', 'middle'),
    );
    recipe.lines
      .slice(0, 4)
      .forEach((line, n) =>
        chunks.push(text(540, 930 + n * 48, label(line, 38), 28, '#cedcec', 'middle')),
      );
  }
  chunks.push(
    `<rect x="52" y="${height - 178}" width="976" height="1" fill="#6c8cac"/>`,
    text(64, height - 128, label(recipe.dateLabel, 50), 26, '#cedcec'),
    text(64, height - 80, label(recipe.venueName || '比赛地点以赛事公告为准', 45), 27, '#ffffff'),
    text(
      64,
      height - 34,
      recipe.omittedPlayerCount
        ? `另有${recipe.omittedPlayerCount}名队员未纳入本版授权素材`
        : '小城市，也有大主场。',
      23,
      '#f7b266',
    ),
    '</svg>',
  );
  return chunks.join('');
}
export async function renderPoster(
  recipe: PosterRecipe,
  thumbnails: ReadonlyMap<string, string> = new Map(),
): Promise<Buffer> {
  await requirePosterChineseFonts();
  const sharp = (await import('sharp')).default;
  const png = await sharp(Buffer.from(posterSvg(recipe, thumbnails)), {
    limitInputPixels: 4_000_000,
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  if (!png.length || png.length > POSTER_MAX_BYTES)
    throw new ApiError(422, 'POSTER_TOO_LARGE', '生成海报超过8MiB，请减少本版照片人数');
  return png;
}
export async function requirePosterChineseFonts(check = posterChineseFontsAvailable) {
  if (!(await check()))
    throw new ApiError(503, 'POSTER_FONT_UNAVAILABLE', '中文字体暂不可用，请联系运营后重试');
}
/** Compare real raster glyphs; two different Han strings must never be identical tofu. */
export async function posterChineseFontsAvailable(): Promise<boolean> {
  // Missing-glyph boxes can contain distinct hexadecimal code points; raster inequality alone
  // is insufficient. Require fontconfig to report a font covering Chinese before the probe.
  try {
    const { stdout } = await promisify(execFile)('fc-list', [':lang=zh', 'family'], {
      timeout: 2000,
      maxBuffer: 16384,
    });
    if (!stdout.trim()) return false;
  } catch {
    return false;
  }
  const sharp = (await import('sharp')).default;
  const draw = (value: string) =>
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="white"/><text x="8" y="58" font-family="sans-serif" font-size="48" fill="black">${value}</text></svg>`,
      ),
    )
      .raw()
      .toBuffer();
  const [a, b, blank] = await Promise.all([draw('青锋'), draw('高州'), draw('')]);
  return !a.equals(b) && !a.equals(blank) && !b.equals(blank);
}
