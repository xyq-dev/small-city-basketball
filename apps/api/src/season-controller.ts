import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { SeasonService } from './season-service.js';
export const SCB_SEASON_SERVICE = 'SCB_SEASON_SERVICE';

const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

/** C19 §5 routes, frozen in docs/design/C19_CONTRACTS.md. */
@Controller()
export class SeasonController {
  constructor(@Inject(SCB_SEASON_SERVICE) readonly service: SeasonService) {}

  @Get('v1/orgs/:orgId/seasons') async list(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.service.listSeasons(r.headers.cookie, org));
  }
  /** 201 on first creation, 200 when the same clientRequestId replays the same content. */
  @Post('v1/orgs/:orgId/seasons') async create(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('orgId') org: string,
    @Body() raw: unknown,
  ) {
    const result = await this.service.createSeason(r.headers.cookie, org, raw);
    response.status(result.created ? 201 : 200);
    return envelope(r, result.season);
  }
  @Get('v1/orgs/:orgId/seasons/:seasonId') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('seasonId') season: string,
  ) {
    return envelope(r, await this.service.getSeason(r.headers.cookie, org, season));
  }
  @Patch('v1/orgs/:orgId/seasons/:seasonId') async update(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('seasonId') season: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.updateSeason(r.headers.cookie, org, season, raw));
  }
  @Post('v1/orgs/:orgId/seasons/:seasonId/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('seasonId') season: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.seasonCommand(r.headers.cookie, org, season, raw));
  }
  @Get('v1/orgs/:orgId/seasons/:seasonId/player-statistics') async statistics(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('seasonId') season: string,
  ) {
    return envelope(r, await this.service.seasonStatistics(r.headers.cookie, org, season));
  }
  @Get('v1/orgs/:orgId/events/:eventId/season-data-grants') async eventGrants(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return envelope(r, await this.service.eventGrants(r.headers.cookie, org, event));
  }
  /** 201 on first nomination, 200 for a replay of the same clientRequestId and content. */
  @Post('v1/orgs/:orgId/events/:eventId/season-data-grants') async nominate(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() raw: unknown,
  ) {
    const result = await this.service.nominate(r.headers.cookie, org, event, raw);
    response.status(result.created ? 201 : 200);
    return envelope(r, result.grant);
  }
  @Post('v1/orgs/:orgId/season-data-grants/:grantId/withdraw') @HttpCode(200) async withdraw(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('grantId') grant: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.withdraw(r.headers.cookie, org, grant, raw));
  }
  @Get('v1/me/season-data-grants') async mine(@Req() r: ApiRequest) {
    return envelope(r, await this.service.myGrants(r.headers.cookie));
  }
  @Post('v1/me/season-data-grants/:grantId/commands') @HttpCode(200) async answer(
    @Req() r: ApiRequest,
    @Param('grantId') grant: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.myGrantCommand(r.headers.cookie, grant, raw));
  }
  @Get('v1/me/season-statistics') async myStatistics(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.mySeasonStatistics(r.headers.cookie, q));
  }
}
