import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApiError, forbidden, notFound } from './errors.js';
import { StandingsService } from './standings-service.js';
import type { StandingsAccess } from './standings-service.js';
import { confirmedResult } from './standings-domain.js';
import { objectInput, resourceId, text } from './validation.js';
import { requestFingerprint, requestId } from './recruitment-domain.js';
import {
  decryptParticipantPayload,
  participantKey,
  participantKeyId,
  PARTICIPANT_TERMS_VERSION,
} from './participant-materials-domain.js';
import {
  POSTER_RENDERER_VERSION,
  parsePosterInput,
  posterDimensions,
  renderPoster,
} from './poster-domain.js';
import type { PosterInput, PosterRecipe } from './poster-domain.js';

type Row = Record<string, any>;
const iso = (v: Date | string) => new Date(v).toISOString();
function unavailable(message = '海报来源或授权已变化，请重新生成'): never {
  throw new ApiError(410, 'POSTER_SOURCE_UNAVAILABLE', message);
}
let activeRenders = 0;

/** Private recipes, no cached private originals or permanent anonymous image URLs. */
export class PosterService extends StandingsService {
  private async manager(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    event: string,
    write = false,
  ) {
    const ctx = await this.context(c, cookie, org),
      a = await this.event(c, ctx, event, write);
    if (!a.manager) throw forbidden();
    await this.ensureFreshSession(c, ctx);
    return a;
  }
  private dto(r: Row) {
    return {
      id: r.id,
      kind: r.kind,
      sourceHash: r.source_hash,
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
      revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
      ...posterDimensions(r.source as PosterRecipe),
      contentType: 'image/png' as const,
    };
  }
  private async once<I extends { clientRequestId: string }>(
    c: PoolClient,
    a: StandingsAccess,
    operation: 'POSTER_GENERATE' | 'POSTER_REVOKE',
    input: I,
    work: () => Promise<Row>,
  ) {
    const hash = requestFingerprint(input);
    const old = (
      await c.query<Row>(
        'SELECT * FROM recruitment_request_receipts WHERE actor_id=$1 AND client_request_id=$2 FOR SHARE',
        [a.ctx.user.id, input.clientRequestId],
      )
    ).rows[0];
    if (old) {
      if (
        old.org_id !== a.ctx.orgId ||
        old.event_id !== a.event.id ||
        old.operation !== operation ||
        old.request_hash !== hash
      )
        throw new ApiError(409, 'REQUEST_ID_CONFLICT', '原请求编号已用于其他内容');
      if (operation === 'POSTER_GENERATE') {
        const row = (
          await c.query<Row>(
            'SELECT * FROM poster_exports WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR SHARE',
            [a.ctx.orgId, a.event.id, old.result.poster?.id],
          )
        ).rows[0];
        if (!row || row.revoked_at || iso(row.expires_at) <= (await this.now(c, a.ctx)))
          unavailable('本次导出已撤销或到期，请核对原回执后重新生成');
        const current = await this.recipe(c, a, parsePosterInput(row.input));
        if (requestFingerprint(current) !== row.source_hash) unavailable();
      }
      return old.result;
    }
    const result = await work();
    await this.ensureFreshSession(c, a.ctx);
    const inserted = await c.query(
      'INSERT INTO recruitment_request_receipts(actor_id,client_request_id,org_id,event_id,operation,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING client_request_id',
      [
        a.ctx.user.id,
        input.clientRequestId,
        a.ctx.orgId,
        a.event.id,
        operation,
        hash,
        JSON.stringify(result),
      ],
    );
    if (!inserted.rowCount) throw new ApiError(409, 'REQUEST_ID_CONFLICT', '请核对原操作回执');
    return result;
  }
  async workspace(cookie: string | undefined, org: string, event: string) {
    return this.transaction(async (c) => {
      const a = await this.manager(c, cookie, org, event),
        plan = await this.plan(c, a.ctx.orgId, a.event.id),
        pub = await this.publication(c, a.ctx.orgId, a.event.id);
      const matches = plan ? await this.matches(c, a.ctx.orgId, a.event.id) : [];
      const exports = (
        await c.query<Row>(
          'SELECT * FROM poster_exports WHERE org_id=$1 AND event_id=$2 ORDER BY created_at DESC,id DESC LIMIT 101',
          [a.ctx.orgId, a.event.id],
        )
      ).rows;
      return {
        event: {
          id: a.event.id,
          name: a.event.name,
          version: a.event.version,
          status: a.event.status,
        },
        participants: Array.isArray(plan?.source?.entries)
          ? plan.source.entries.map((e: Row) => ({ entryId: e.entryId, teamName: e.teamName }))
          : [],
        matches: matches.map((m) => ({
          id: m.id,
          homeTeamName: m.home_team_name,
          awayTeamName: m.away_team_name,
          displayName: `${m.home_team_name} 对 ${m.away_team_name} · ${iso(m.starts_at)}`,
          status: m.status,
          startsAt: iso(m.starts_at),
        })),
        exports: exports.slice(0, 100).map((r) => this.dto(r)),
        historyTruncated: exports.length > 100,
        capabilities: {
          canGenerate:
            !!pub &&
            !pub.revoked_at &&
            ['SCHEDULED', 'RUNNING', 'COMPLETED', 'ARCHIVED'].includes(a.event.status),
        },
        notice:
          '海报生成和每次下载均重新检查公开来源及逐人宣传授权；已下载或外部转发的图片无法保证追回。',
      };
    });
  }
  private async recipe(
    c: PoolClient,
    a: StandingsAccess,
    input: PosterInput,
  ): Promise<PosterRecipe> {
    const pub = await this.publication(c, a.ctx.orgId, a.event.id);
    if (!pub || pub.revoked_at) unavailable('请先显式发布本届观赛内容，再生成宣传海报');
    // Freeze mutable result rows while source facts are checked and the raster is generated.
    await c.query(
      'SELECT id FROM published_matches WHERE org_id=$1 AND event_id=$2 ORDER BY id FOR SHARE',
      [a.ctx.orgId, a.event.id],
    );
    const b = await this.publicBundle(c, pub.public_event_id);
    const recipe: PosterRecipe = {
      rendererVersion: POSTER_RENDERER_VERSION,
      kind: input.kind,
      eventName: b.event.name,
      dateLabel: `${b.event.start_date} — ${b.event.end_date}`,
      venueName: b.event.venue_name,
      headline: '',
      subtitle: '',
      teams: [],
      score: null,
      lines: [],
      players: [],
      omittedPlayerCount: 0,
      publicationId: b.pub.id,
      proof: null,
    };
    if (input.kind === 'ROSTER') {
      const entry = (b.plan.source.entries as Row[]).find((e) => e.entryId === input.entryId);
      if (!entry || !Array.isArray(entry.players)) unavailable('队伍不属于本次正式冻结名单');
      await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
        a.ctx.orgId,
        entry.teamId,
      ]);
      const ids = new Set((entry.players as Row[]).map((p) => p.memberId));
      if (input.memberIds.some((id) => !ids.has(id))) unavailable('所选队员不属于本届冻结名单');
      const selected = (entry.players as Row[])
        .filter((p) => !input.memberIds.length || input.memberIds.includes(p.memberId))
        .sort((x, y) => x.memberId.localeCompare(y.memberId, 'en'));
      const materials = (
        await c.query<Row>(
          `SELECT m.id AS material_id,m.version AS material_version,m.member_id,m.user_id,m.status,m.publicity_consent,m.reservation_active,m.reviewed_start_date::text,m.reviewed_end_date::text,m.key_id AS head_key_id,
          r.id AS revision_id,r.roster_revision_id,r.ruleset_id,r.jersey_no,r.terms_version,r.has_signature,r.portrait_sha256,r.portrait_bytes,r.purged_at,r.key_id
        FROM participant_materials m
        JOIN participant_material_revisions r ON r.id=m.current_revision_id AND r.material_id=m.id
        JOIN team_member_bindings bind ON bind.id=m.binding_id AND bind.org_id=m.org_id AND bind.team_id=m.team_id AND bind.member_id=m.member_id AND bind.user_id=m.user_id AND bind.status='ACTIVE'
        JOIN team_members tm ON tm.org_id=bind.org_id AND tm.team_id=bind.team_id AND tm.id=bind.member_id AND tm.status='ACTIVE'
        JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
        WHERE m.org_id=$1 AND m.event_id=$2 AND m.entry_id=$3
        ORDER BY m.member_id FOR SHARE OF m,r,bind,tm,u`,
          [a.ctx.orgId, a.event.id, entry.entryId],
        )
      ).rows;
      const byMember = new Map(materials.map((m) => [m.member_id, m]));
      for (const player of selected) {
        const m = byMember.get(player.memberId);
        if (
          !m ||
          !m.publicity_consent ||
          m.status !== 'APPROVED' ||
          !m.reservation_active ||
          m.purged_at ||
          !m.portrait_sha256 ||
          !m.portrait_bytes ||
          !m.has_signature ||
          m.terms_version !== PARTICIPANT_TERMS_VERSION ||
          m.roster_revision_id !== entry.rosterRevisionId ||
          m.jersey_no !== player.jerseyNo ||
          m.ruleset_id !== (a.event as unknown as Row).locked_ruleset_id ||
          m.reviewed_start_date !== b.event.start_date ||
          m.reviewed_end_date !== b.event.end_date ||
          m.key_id !== m.head_key_id
        ) {
          recipe.omittedPlayerCount++;
          continue;
        }
        if (
          input.includePortraits &&
          m.key_id !== participantKeyId(participantKey(this.options.participantDataKey))
        )
          throw new ApiError(503, 'PARTICIPANT_DATA_UNAVAILABLE', '授权照片安全存储暂不可用');
        recipe.players.push({
          memberId: player.memberId,
          name: player.name,
          jerseyNo: player.jerseyNo,
          materialId: m.material_id,
          revisionId: m.revision_id,
          materialVersion: m.material_version,
          portraitHash: m.portrait_sha256,
          includePortrait: input.includePortraits,
        });
      }
      recipe.headline = entry.teamName;
      recipe.subtitle = `本届已授权阵容 · ${recipe.players.length}人`;
      recipe.teams = [entry.teamName];
      recipe.proof = {
        entryId: entry.entryId,
        rosterRevisionId: entry.rosterRevisionId,
        rulesetId: (a.event as unknown as Row).locked_ruleset_id,
        selectedMemberIds: selected.map((p) => p.memberId),
      };
    } else if (input.kind === 'MATCHUP' || input.kind === 'RESULT') {
      const match = b.rows.find((m) => m.id === input.matchId);
      if (!match || ['CANCELLED', 'POSTPONED'].includes(match.status))
        unavailable('当前对阵已取消、延期或不属于有效公开赛程');
      recipe.teams = [match.home_team_name, match.away_team_name];
      recipe.venueName = match.court_name;
      recipe.dateLabel =
        new Date(new Date(match.starts_at).getTime() + 8 * 3600000)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 16) + ' 北京时间';
      recipe.proof = {
        matchId: match.id,
        homeEntryId: match.home_entry_id,
        awayEntryId: match.away_entry_id,
        startsAt: iso(match.starts_at),
        endsAt: iso(match.ends_at),
        courtId: match.court_id,
      };
      if (input.kind === 'RESULT') {
        const result = confirmedResult(match);
        if (!result) unavailable('战报只使用当前有效的独立确认赛果');
        recipe.headline = '赛后战报';
        recipe.subtitle = '当前独立确认赛果';
        recipe.score = `${result.homeScore} : ${result.awayScore}`;
        recipe.proof = { fixture: recipe.proof, result };
        recipe.lines = ['以当前有效独立确认赛果为准', '后续更正须重新生成'];
      } else {
        recipe.headline = '比赛预告';
        recipe.subtitle = '正式发布对阵';
        recipe.lines = ['比赛时间与场地以最新赛事信息为准'];
      }
    } else {
      if (!['COMPLETED', 'ARCHIVED'].includes(b.event.status) || b.pub.purpose !== 'HISTORY')
        unavailable('荣誉海报须在整届完赛并显式发布历史成绩后生成');
      const competition = b.groupCompetition ?? b.bracket ?? b.standings;
      if (!competition?.isComplete) unavailable('整届成绩来源尚未完整确认');
      const placements =
        b.groupCompetition?.placements ?? b.bracket?.placements ?? b.standings?.rows ?? [];
      const ranked = placements
        .filter((p) => p.rank !== null && p.rank <= 3)
        .map((p) => ({ entryId: p.entryId, teamName: p.teamName, rank: p.rank, tied: p.tied }));
      if (!ranked.length) unavailable('当前没有可核验的最终名次');
      recipe.headline = '赛事荣誉';
      recipe.subtitle = '整届有效确认与最终名次';
      recipe.lines = ranked.map((p) => `${p.tied ? '并列' : ''}第${p.rank}名  ${p.teamName}`);
      recipe.proof = { sourceHash: competition.sourceHash, ranked };
    }
    return recipe;
  }
  private async rendered(c: PoolClient, a: StandingsAccess, recipe: PosterRecipe) {
    if (activeRenders >= 2)
      throw new ApiError(429, 'POSTER_RENDER_BUSY', '海报生成繁忙，请稍后沿用原编号核对');
    activeRenders++;
    try {
      const thumbs = new Map<string, string>();
      if (recipe.players.some((p) => p.includePortrait)) {
        const key = participantKey(this.options.participantDataKey),
          sharp = (await import('sharp')).default;
        for (const player of recipe.players.filter((p) => p.includePortrait)) {
          const row = (
            await c.query<Row>(
              'SELECT r.payload_ciphertext,r.user_id,r.entry_id,r.member_id,r.id FROM participant_material_revisions r WHERE r.org_id=$1 AND r.event_id=$2 AND r.material_id=$3 AND r.id=$4 AND r.purged_at IS NULL FOR SHARE',
              [a.ctx.orgId, a.event.id, player.materialId, player.revisionId],
            )
          ).rows[0];
          if (!row?.payload_ciphertext) unavailable();
          const payload = decryptParticipantPayload(row.payload_ciphertext, key, {
            orgId: a.ctx.orgId,
            eventId: a.event.id,
            entryId: row.entry_id,
            memberId: row.member_id,
            userId: row.user_id,
            revisionId: row.id,
          });
          if (!payload.portrait || payload.portrait.sha256 !== player.portraitHash) unavailable();
          const thumb = await sharp(Buffer.from(payload.portrait.base64, 'base64'), {
            limitInputPixels: 16_777_216,
          })
            .rotate()
            .resize(130, 130, { fit: 'cover' })
            .jpeg({ quality: 82 })
            .toBuffer();
          thumbs.set(player.memberId, thumb.toString('base64'));
        }
      }
      return await renderPoster(recipe, thumbs);
    } finally {
      activeRenders--;
    }
  }
  async generate(cookie: string | undefined, org: string, event: string, raw: unknown) {
    const input = parsePosterInput(raw);
    const actor = await this.session(cookie);
    await this.rateLimit(`x05:poster:${actor.user.id}`, 10, 60);
    return this.transaction(async (c) => {
      const a = await this.manager(c, cookie, org, event, true);
      return this.once(c, a, 'POSTER_GENERATE', input, async () => {
        if (a.event.version !== input.expectedEventVersion)
          throw new ApiError(409, 'VERSION_CONFLICT', '赛事已变化，请重新核对', {
            currentVersion: a.event.version,
          });
        const recipe = await this.recipe(c, a, input);
        await this.rendered(c, a, recipe);
        const hash = requestFingerprint(recipe);
        const row = (
          await c.query<Row>(
            "INSERT INTO poster_exports(id,org_id,event_id,public_publication_id,actor_id,kind,input,source_hash,source,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,clock_timestamp()+interval '24 hours') RETURNING *",
            [
              randomUUID(),
              a.ctx.orgId,
              a.event.id,
              recipe.publicationId,
              a.ctx.user.id,
              input.kind,
              JSON.stringify(input),
              hash,
              JSON.stringify(recipe),
            ],
          )
        ).rows[0]!;
        await this.audit(
          c,
          a.ctx.user.id,
          a.ctx.orgId,
          'poster.generated',
          'poster-export',
          row.id,
          {
            kind: input.kind,
            sourceHash: hash,
            authorizedPortraitCount: recipe.players.filter((p) => p.includePortrait).length,
          },
        );
        return { poster: this.dto(row), omittedPlayerCount: recipe.omittedPlayerCount };
      });
    });
  }
  async download(cookie: string | undefined, org: string, event: string, exportId: string) {
    const actor = await this.session(cookie);
    await this.rateLimit(`x05:poster-download:${actor.user.id}`, 20, 60);
    return this.transaction(async (c) => {
      const a = await this.manager(c, cookie, org, event);
      const row = (
        await c.query<Row>(
          'SELECT * FROM poster_exports WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR SHARE',
          [a.ctx.orgId, a.event.id, resourceId(exportId)],
        )
      ).rows[0];
      if (!row) throw notFound();
      const now = await this.now(c, a.ctx);
      if (row.revoked_at || iso(row.expires_at) <= now)
        unavailable('本次导出已撤销或到期，请重新生成');
      const recipe = await this.recipe(c, a, parsePosterInput(row.input));
      if (
        requestFingerprint(recipe) !== row.source_hash ||
        recipe.publicationId !== row.public_publication_id
      )
        unavailable();
      const bytes = await this.rendered(c, a, recipe);
      await this.ensureFreshSession(c, a.ctx);
      await this.audit(
        c,
        a.ctx.user.id,
        a.ctx.orgId,
        'poster.downloaded',
        'poster-export',
        row.id,
        { sourceHash: row.source_hash },
      );
      return {
        bytes,
        contentType: 'image/png',
        filename: `basketball-${row.kind.toLowerCase()}-${row.id}.png`,
      };
    });
  }
  async revoke(
    cookie: string | undefined,
    org: string,
    event: string,
    exportId: string,
    raw: unknown,
  ) {
    const i = objectInput(raw, ['clientRequestId', 'reason']);
    const input = {
      clientRequestId: requestId(i.clientRequestId),
      exportId: resourceId(exportId),
      reason: text(i.reason, 'reason', 4, 500),
    };
    return this.transaction(async (c) => {
      const a = await this.manager(c, cookie, org, event, true);
      return this.once(c, a, 'POSTER_REVOKE', input, async () => {
        let row = (
          await c.query<Row>(
            'SELECT * FROM poster_exports WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE',
            [a.ctx.orgId, a.event.id, input.exportId],
          )
        ).rows[0];
        if (!row) throw notFound();
        if (!row.revoked_at)
          row = (
            await c.query<Row>(
              'UPDATE poster_exports SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *',
              [row.id, a.ctx.user.id, input.reason],
            )
          ).rows[0]!;
        await this.audit(c, a.ctx.user.id, a.ctx.orgId, 'poster.revoked', 'poster-export', row.id);
        return { poster: this.dto(row) };
      });
    });
  }
}
