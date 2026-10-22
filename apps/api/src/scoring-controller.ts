import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { ScoringService } from './scoring-service.js';
export const SCB_SCORING_SERVICE = 'SCB_SCORING_SERVICE';
const envelope = <T>(r: ApiRequest, data: T, meta: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: r.requestId, ...meta },
});
@Controller('v1/orgs/:orgId')
export class ScoringController {
  constructor(@Inject(SCB_SCORING_SERVICE) private readonly service: ScoringService) {}
  @Get('scoring-matches') async matches(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.listScoringMatches(r.headers.cookie, org, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
  @Get('events/:eventId/scoring') async event(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return envelope(r, await this.service.getEventScoring(r.headers.cookie, org, id));
  }
  @Put('events/:eventId/scoring-rules') async rules(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.updateScoringRules(r.headers.cookie, org, id, b));
  }
  @Get('matches/:matchId/scoring') async match(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
  ) {
    return envelope(r, await this.service.getWorkbench(r.headers.cookie, org, id));
  }
  @Put('matches/:matchId/staff/:userId') async staff(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('userId') user: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.updateMatchStaff(r.headers.cookie, org, id, user, b));
  }
  @Post('matches/:matchId/scorekeeper-lease') @HttpCode(200) async acquire(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.acquireLease(r.headers.cookie, org, id, b));
  }
  @Post('matches/:matchId/scorekeeper-lease/renew') @HttpCode(200) async renew(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.renewLease(r.headers.cookie, org, id, b));
  }
  @Delete('matches/:matchId/scorekeeper-lease') async release(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.releaseLease(r.headers.cookie, org, id, b));
  }
  @Post('matches/:matchId/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.executeCommand(r.headers.cookie, org, id, b));
  }
  @Get('matches/:matchId/commands/:commandId') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('commandId') command: string,
  ) {
    return envelope(r, await this.service.getCommand(r.headers.cookie, org, id, command));
  }
  @Get('matches/:matchId/snapshot') async snapshot(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
  ) {
    return envelope(r, await this.service.getSnapshot(r.headers.cookie, org, id));
  }
  @Get('matches/:matchId/scoring-events') async events(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.listScoringEvents(r.headers.cookie, org, id, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
  @Get('matches/:matchId/result-confirmations') async confirmations(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.listResultConfirmations(r.headers.cookie, org, id, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
}
