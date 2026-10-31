import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  EventTemplateCatalog,
  EventTemplateCommandReceipt,
  EventTemplateConfiguration,
  EventTemplateData,
  EventSetupGuide,
} from '../../../packages/contracts/event-templates.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { SchedulingService } from './scheduling-service.js';
import type { RevisionRow } from './scheduling-service.js';
import type { OrgActor } from './service.js';
import { isAdministrator } from './service.js';
import { resourceId } from './validation.js';
import {
  configurationHash,
  deriveSetupGuide,
  parseTemplateCommand,
  parseTemplateConfiguration,
  templatePresets,
} from './event-template-domain.js';

type TemplateRow = Record<string, any>;
const templateSelect = `SELECT h.*,v.configuration,v.configuration_hash FROM event_templates h JOIN event_template_versions v ON v.org_id=h.org_id AND v.template_id=h.id AND v.id=h.current_version_id`;
export class EventTemplateService extends SchedulingService {
  private administrator(ctx: OrgActor) {
    if (!isAdministrator(ctx.role)) throw forbidden();
  }
  private templateDto(row: TemplateRow): EventTemplateData {
    const configuration = parseTemplateConfiguration(row.configuration);
    if (configurationHash(configuration) !== row.configuration_hash)
      throw new ApiError(409, 'TEMPLATE_SOURCE_INVALID', '模板配置来源无法核验');
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      versionId: row.current_version_id,
      status: row.status,
      configuration,
      configurationHash: row.configuration_hash,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
  private async template(c: PoolClient, ctx: OrgActor, id: string, writing = false) {
    const row = (
      await c.query(
        `${templateSelect} WHERE h.org_id=$1 AND h.id=$2 FOR ${writing ? 'UPDATE' : 'SHARE'} OF h`,
        [ctx.orgId, resourceId(id)],
      )
    ).rows[0];
    if (!row) throw notFound();
    return this.templateDto(row);
  }
  async listTemplates(cookie: string | undefined, org: string): Promise<EventTemplateCatalog> {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      this.administrator(ctx);
      const rows = (
        await c.query(
          `${templateSelect} WHERE h.org_id=$1 ORDER BY h.created_at DESC,h.id DESC LIMIT 101`,
          [ctx.orgId],
        )
      ).rows;
      await this.ensureFreshSession(c, ctx);
      return {
        templates: rows.slice(0, 100).map((r) => this.templateDto(r)),
        presets: templatePresets(),
        truncated: rows.length > 100,
        capabilities: { canManageTemplates: true, canInstantiate: true },
      };
    });
  }
  async getTemplateReceipt(
    cookie: string | undefined,
    org: string,
    id: string,
  ): Promise<EventTemplateCommandReceipt> {
    const requestId = resourceId(id);
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      this.administrator(ctx);
      const row = (
        await c.query(
          'SELECT result FROM event_template_commands WHERE org_id=$1 AND actor_id=$2 AND client_request_id=$3',
          [ctx.orgId, ctx.user.id, requestId],
        )
      ).rows[0];
      if (!row) throw notFound();
      await this.ensureFreshSession(c, ctx);
      return row.result;
    });
  }
  private async createTemplateRecord(
    c: PoolClient,
    ctx: OrgActor,
    name: string,
    configuration: EventTemplateConfiguration,
  ) {
    const id = randomUUID(),
      versionId = randomUUID();
    await c.query(
      'INSERT INTO event_templates(id,org_id,name,current_version_id,created_by) VALUES($1,$2,$3,$4,$5)',
      [id, ctx.orgId, name, versionId, ctx.user.id],
    );
    await this.insertVersion(c, ctx, id, versionId, 1, configuration);
    return this.template(c, ctx, id);
  }
  private async insertVersion(
    c: PoolClient,
    ctx: OrgActor,
    id: string,
    versionId: string,
    version: number,
    configuration: EventTemplateConfiguration,
  ) {
    await c.query(
      'INSERT INTO event_template_versions(id,org_id,template_id,version_number,configuration,configuration_hash,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)',
      [
        versionId,
        ctx.orgId,
        id,
        version,
        JSON.stringify(configuration),
        configurationHash(configuration),
        ctx.user.id,
      ],
    );
  }
  private async ruleRows(c: PoolClient, ctx: OrgActor, eventId: string) {
    return (
      await c.query(
        `SELECT row_to_json(r) registration,row_to_json(s) scoring,row_to_json(t) standings,e.locked_standings_ruleset_id
      FROM events e LEFT JOIN event_rulesets r ON r.org_id=e.org_id AND r.event_id=e.id AND r.id=e.current_ruleset_id
      LEFT JOIN scoring_rulesets s ON s.org_id=e.org_id AND s.event_id=e.id AND s.id=e.current_scoring_ruleset_id
      LEFT JOIN standings_rulesets t ON t.org_id=e.org_id AND t.event_id=e.id AND t.id=e.current_standings_ruleset_id
      WHERE e.org_id=$1 AND e.id=$2`,
        [ctx.orgId, eventId],
      )
    ).rows[0]!;
  }
  private configurationFromRows(
    format: EventTemplateConfiguration['format'],
    rows: TemplateRow,
    scheduling: unknown,
    expectedTeams: number | null,
  ) {
    const r = rows.registration,
      s = rows.scoring,
      t = rows.standings;
    if (!r || !s || (format !== 'SINGLE_ELIMINATION' && !t))
      throw new ApiError(422, 'TEMPLATE_RULES_REQUIRED', '请先保存完整的报名、记分和积分规则');
    return parseTemplateConfiguration({
      format,
      expectedTeams,
      scheduling,
      registration: {
        minPlayers: r.min_players,
        maxPlayers: r.max_players,
        zeroAndDoubleZeroDistinct: r.zero_and_double_zero_distinct,
        requireIdentity: r.require_identity,
        requireInsurance: r.require_insurance,
        requireParticipantMaterials: r.require_participant_materials,
      },
      scoring: {
        regulationPeriods: s.regulation_periods,
        periodDurationSeconds: s.period_duration_seconds,
        allowedScoreValues: s.allowed_score_values,
        tiePolicy: s.tie_policy,
        overtimeDurationSeconds: s.overtime_duration_seconds,
      },
      standings:
        format === 'SINGLE_ELIMINATION'
          ? null
          : {
              winPoints: t.win_points,
              lossPoints: t.loss_points,
              drawPoints: t.draw_points,
              tiebreakers: t.tiebreakers,
            },
    });
  }
  async executeTemplate(
    cookie: string | undefined,
    org: string,
    raw: unknown,
  ): Promise<EventTemplateCommandReceipt> {
    const command = parseTemplateCommand(raw);
    const inputHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org);
      this.administrator(ctx);
      await this.ensureFreshSession(c, ctx);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `x03:${ctx.orgId}:${ctx.user.id}:${command.clientRequestId}`,
      ]);
      const previous = (
        await c.query(
          'SELECT input_hash,result FROM event_template_commands WHERE org_id=$1 AND actor_id=$2 AND client_request_id=$3',
          [ctx.orgId, ctx.user.id, command.clientRequestId],
        )
      ).rows[0];
      if (previous) {
        if (previous.input_hash !== inputHash)
          throw new ApiError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            '命令编号已用于不同内容，请先核对原请求',
          );
        await this.ensureFreshSession(c, ctx);
        return previous.result;
      }
      let template: EventTemplateData;
      let event: EventTemplateCommandReceipt['event'] = null;
      let operation: EventTemplateCommandReceipt['operation'];
      if (command.type === 'CREATE_TEMPLATE') {
        operation = 'CREATE_TEMPLATE';
        template = await this.createTemplateRecord(c, ctx, command.name, command.configuration);
      } else if (command.type === 'CREATE_FROM_EVENT') {
        operation = 'CREATE_TEMPLATE';
        const access = await this.event(c, ctx, command.eventId, false);
        if (access.row.version !== command.expectedEventVersion)
          throw new ApiError(409, 'VERSION_CONFLICT', '赛事配置已更新，请重新读取后保存模板');
        const configuration = this.configurationFromRows(
          access.row.format,
          await this.ruleRows(c, ctx, access.row.id),
          command.scheduling,
          command.expectedTeams,
        );
        template = await this.createTemplateRecord(c, ctx, command.name, configuration);
      } else if (command.type === 'UPDATE_TEMPLATE' || command.type === 'ARCHIVE_TEMPLATE') {
        template = await this.template(c, ctx, command.templateId!, true);
        if (template.version !== command.expectedTemplateVersion)
          throw new ApiError(409, 'VERSION_CONFLICT', '模板已更新，请重新读取');
        if (template.status !== 'ACTIVE')
          throw new ApiError(409, 'TEMPLATE_ARCHIVED', '已归档的模板不能修改或实例化');
        if (command.type === 'ARCHIVE_TEMPLATE') {
          operation = 'ARCHIVE_TEMPLATE';
          await c.query(
            "UPDATE event_templates SET status='ARCHIVED',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
            [ctx.orgId, template.id],
          );
        } else {
          operation = 'UPDATE_TEMPLATE';
          const versionId = randomUUID();
          await c.query(
            'UPDATE event_templates SET name=$3,current_version_id=$4,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
            [ctx.orgId, template.id, command.name, versionId],
          );
          await this.insertVersion(
            c,
            ctx,
            template.id,
            versionId,
            template.version + 1,
            command.configuration,
          );
        }
        template = await this.template(c, ctx, template.id);
      } else {
        operation = 'INSTANTIATE';
        if ('presetKey' in command) {
          const preset = templatePresets().find((p) => p.key === command.presetKey)!;
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `x03-preset:${ctx.orgId}:${preset.key}`,
          ]);
          const row = (
            await c.query(
              `${templateSelect} WHERE h.org_id=$1 AND h.status='ACTIVE' AND v.configuration_hash=$2 ORDER BY h.created_at,h.id LIMIT 1 FOR SHARE OF h`,
              [ctx.orgId, configurationHash(preset.configuration)],
            )
          ).rows[0];
          template = row
            ? this.templateDto(row)
            : await this.createTemplateRecord(c, ctx, preset.name, preset.configuration);
        } else {
          template = await this.template(c, ctx, command.templateId!, false);
          if (template.status !== 'ACTIVE')
            throw new ApiError(409, 'TEMPLATE_ARCHIVED', '已归档的模板不能实例化');
          if (
            template.version !== command.expectedTemplateVersion ||
            template.versionId !== command.templateVersionId
          )
            throw new ApiError(409, 'VERSION_CONFLICT', '模板已更新，请重新选择并核对配置');
        }
        const cfg = template.configuration,
          id = randomUUID();
        const e = command.event;
        await c.query(
          `INSERT INTO events(id,org_id,name,start_date,end_date,timezone,venue_name,format,created_by) VALUES($1,$2,$3,$4::date,$5::date,'Asia/Shanghai',$6,$7,$8)`,
          [id, ctx.orgId, e.name, e.startDate, e.endDate, e.venueName, cfg.format, ctx.user.id],
        );
        const rId = randomUUID(),
          sId = randomUUID(),
          tId = cfg.standings ? randomUUID() : null,
          r = cfg.registration,
          s = cfg.scoring,
          t = cfg.standings;
        await c.query(
          `INSERT INTO event_rulesets(id,org_id,event_id,version,min_players,max_players,zero_and_double_zero_distinct,require_identity,require_insurance,require_participant_materials,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)`,
          [
            rId,
            ctx.orgId,
            id,
            r.minPlayers,
            r.maxPlayers,
            r.zeroAndDoubleZeroDistinct,
            r.requireIdentity,
            r.requireInsurance,
            r.requireParticipantMaterials ?? false,
            ctx.user.id,
          ],
        );
        await c.query(
          `INSERT INTO scoring_rulesets(id,org_id,event_id,version,regulation_periods,period_duration_seconds,allowed_score_values,tie_policy,overtime_duration_seconds,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9)`,
          [
            sId,
            ctx.orgId,
            id,
            s.regulationPeriods,
            s.periodDurationSeconds,
            s.allowedScoreValues,
            s.tiePolicy,
            s.overtimeDurationSeconds,
            ctx.user.id,
          ],
        );
        if (t)
          await c.query(
            `INSERT INTO standings_rulesets(id,org_id,event_id,version,win_points,loss_points,draw_points,tiebreakers,created_by) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8)`,
            [
              tId,
              ctx.orgId,
              id,
              t.winPoints,
              t.lossPoints,
              t.drawPoints,
              t.tiebreakers,
              ctx.user.id,
            ],
          );
        await c.query(
          'UPDATE events SET current_ruleset_id=$3,current_scoring_ruleset_id=$4,current_standings_ruleset_id=$5,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2',
          [ctx.orgId, id, rId, sId, tId],
        );
        await c.query(
          'INSERT INTO event_template_instances(org_id,event_id,template_id,template_version_id,configuration,configuration_hash,expected_team_count,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',
          [
            ctx.orgId,
            id,
            template.id,
            template.versionId,
            JSON.stringify(cfg),
            template.configurationHash,
            cfg.expectedTeams,
            ctx.user.id,
          ],
        );
        event = this.dtoEvent(await this.event(c, ctx, id, false));
      }
      const receipt = { clientRequestId: command.clientRequestId, operation, template, event };
      await this.ensureFreshSession(c, ctx);
      await this.audit(
        c,
        ctx.user.id,
        ctx.orgId,
        `EVENT_TEMPLATE_${operation}`,
        'event_template',
        template.id,
        {
          clientRequestId: command.clientRequestId,
          eventId: event?.id ?? null,
          ...(command.type === 'ARCHIVE_TEMPLATE' ? { reason: command.reason } : {}),
        },
      );
      await c.query(
        'INSERT INTO event_template_commands(org_id,actor_id,client_request_id,operation,input_hash,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
        [
          ctx.orgId,
          ctx.user.id,
          command.clientRequestId,
          operation,
          inputHash,
          JSON.stringify(receipt),
        ],
      );
      return receipt;
    });
  }
  async setupGuide(
    cookie: string | undefined,
    org: string,
    eventId: string,
  ): Promise<EventSetupGuide> {
    return this.transaction(async (c) => {
      const ctx = await this.context(c, cookie, org),
        access = await this.event(c, ctx, eventId, false);
      const state = await this.schedulingDto(c, ctx, access),
        rules = await this.ruleRows(c, ctx, access.row.id);
      const instance = (
        await c.query('SELECT * FROM event_template_instances WHERE org_id=$1 AND event_id=$2', [
          ctx.orgId,
          access.row.id,
        ])
      ).rows[0];
      const template = instance
        ? {
            id: instance.template_id,
            versionId: instance.template_version_id,
            expectedTeams: instance.expected_team_count,
            configuration: parseTemplateConfiguration(instance.configuration),
          }
        : null;
      if (instance && configurationHash(template!.configuration) !== instance.configuration_hash)
        throw new ApiError(409, 'TEMPLATE_SOURCE_INVALID', '模板实例配置来源无法核验');
      const counts = (
        await c.query(
          `SELECT count(*) FILTER(WHERE status='APPROVED')::int approved,count(*) FILTER(WHERE status='SUBMITTED')::int submitted,count(*) FILTER(WHERE status='CHANGES_REQUESTED')::int AS "changesRequested" FROM entries WHERE org_id=$1 AND event_id=$2`,
          [ctx.orgId, access.row.id],
        )
      ).rows[0];
      let fixtures = 0,
        assigned = 0,
        conflicts = 0;
      if (state.currentRevision) {
        const revision = (
          await c.query<RevisionRow>(
            'SELECT * FROM schedule_revisions WHERE org_id=$1 AND event_id=$2 AND id=$3',
            [ctx.orgId, access.row.id, state.currentRevision.id],
          )
        ).rows[0]!;
        const rows = await this.fixtures(c, revision);
        fixtures = rows.length;
        assigned = rows.filter((f) => f.startsAt && f.courtId && f.endsAt).length;
        if (revision.status === 'DRAFT') {
          try {
            conflicts = (await this.validation(c, ctx, access, revision)).conflicts.length;
          } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            conflicts = 1;
          }
        }
      }
      const r = rules.registration;
      const guide = deriveSetupGuide({
        eventVersion: access.row.version,
        status: access.row.status,
        format: access.row.format,
        canManage: access.canManage,
        registrationRules: !!r,
        scoringRules: !!rules.scoring,
        standingsLocked: !!rules.locked_standings_ruleset_id,
        registrationBlocked:
          !!r &&
          (((r.require_identity || r.require_insurance) && !r.require_participant_materials) ||
            (r.require_participant_materials && !this.options.participantDataKey)),
        template,
        frozen: !!state.freeze,
        revision: !!state.currentRevision,
        published: !!state.publication,
        conflicts,
        counts: { ...counts, frozen: state.freeze?.entryCount ?? 0, fixtures, assigned },
      });
      await this.ensureFreshSession(c, ctx);
      return guide;
    });
  }
}
