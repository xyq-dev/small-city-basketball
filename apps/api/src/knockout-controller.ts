import { Controller, Get, HttpCode, Inject, Param, Post, Req, Body } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { KnockoutService } from './knockout-service.js';
export const SCB_KNOCKOUT_SERVICE = 'SCB_KNOCKOUT_SERVICE';
@Controller('v1/orgs/:orgId/events/:eventId')
export class KnockoutController {
  constructor(@Inject(SCB_KNOCKOUT_SERVICE) private readonly service: KnockoutService) {}
  @Get('knockout') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return {
      data: await this.service.getKnockout(r.headers.cookie, org, event),
      meta: { requestId: r.requestId },
    };
  }
  @Post('knockout-round-commands') @HttpCode(200) async publish(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.service.publishKnockoutRound(r.headers.cookie, org, event, body),
      meta: { requestId: r.requestId },
    };
  }
}
