import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { StandingsService } from './standings-service.js';
export const SCB_STANDINGS_SERVICE = 'SCB_STANDINGS_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/events/:eventId')
export class StandingsController {
  constructor(@Inject(SCB_STANDINGS_SERVICE) private readonly service: StandingsService) {}
  @Get('standings') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return envelope(r, await this.service.getStandings(r.headers.cookie, org, id));
  }
  @Put('standings-rules') async rules(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.updateRules(r.headers.cookie, org, id, b));
  }
  @Post('standings-rule-commands') @HttpCode(200) async publish(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.ruleCommand(r.headers.cookie, org, id, b));
  }
  @Post('public-viewing-commands') @HttpCode(200) async viewing(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.publicViewingCommand(r.headers.cookie, org, id, b));
  }
}
