import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { MatchExceptionService } from './match-exception-service.js';
export const SCB_MATCH_EXCEPTION_SERVICE = 'SCB_MATCH_EXCEPTION_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId')
export class MatchExceptionController {
  constructor(
    @Inject(SCB_MATCH_EXCEPTION_SERVICE) private readonly service: MatchExceptionService,
  ) {}
  @Get('events/:eventId/exception-rules') async rules(
    @Req() r: ApiRequest,
    @Param('orgId') o: string,
    @Param('eventId') e: string,
  ) {
    return envelope(r, await this.service.getRules(r.headers.cookie, o, e));
  }
  @Put('events/:eventId/exception-rules') async setRules(
    @Req() r: ApiRequest,
    @Param('orgId') o: string,
    @Param('eventId') e: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.setRules(r.headers.cookie, o, e, b));
  }
  @Get('matches/:matchId/exceptions') async get(
    @Req() r: ApiRequest,
    @Param('orgId') o: string,
    @Param('matchId') m: string,
  ) {
    return envelope(r, await this.service.get(r.headers.cookie, o, m));
  }
  @Post('matches/:matchId/exceptions/proposals') @HttpCode(200) async propose(
    @Req() r: ApiRequest,
    @Param('orgId') o: string,
    @Param('matchId') m: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.propose(r.headers.cookie, o, m, b));
  }
  @Post('matches/:matchId/exceptions/:requestId/review') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('orgId') o: string,
    @Param('matchId') m: string,
    @Param('requestId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.review(r.headers.cookie, o, m, id, b));
  }
}
