import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { GroupKnockoutService } from './group-knockout-service.js';
export const SCB_GROUP_KNOCKOUT_SERVICE = 'SCB_GROUP_KNOCKOUT_SERVICE';
@Controller('v1/orgs/:orgId/events/:eventId')
export class GroupKnockoutController {
  constructor(@Inject(SCB_GROUP_KNOCKOUT_SERVICE) private readonly service: GroupKnockoutService) {}
  @Get('groups') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return {
      data: await this.service.getGroups(r.headers.cookie, org, id),
      meta: { requestId: r.requestId },
    };
  }
  @Post('group-tie-commands') @HttpCode(200) async draw(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() raw: unknown,
  ) {
    return {
      data: await this.service.drawGroupTie(r.headers.cookie, org, id, raw),
      meta: { requestId: r.requestId },
    };
  }
  @Post('group-qualification-commands') @HttpCode(200) async publish(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() raw: unknown,
  ) {
    return {
      data: await this.service.publishQualification(r.headers.cookie, org, id, raw),
      meta: { requestId: r.requestId },
    };
  }
  @Post('group-optimization-preview') @HttpCode(200) async optimize(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return {
      data: await this.service.previewNextRoundOptimization(r.headers.cookie, org, event, body),
      meta: { requestId: r.requestId },
    };
  }
}
