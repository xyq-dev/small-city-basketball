import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { EventLifecycleService } from './event-lifecycle-service.js';

export const SCB_EVENT_LIFECYCLE_SERVICE = 'SCB_EVENT_LIFECYCLE_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

@Controller('v1/orgs/:orgId/events/:eventId')
export class EventLifecycleController {
  constructor(
    @Inject(SCB_EVENT_LIFECYCLE_SERVICE) private readonly service: EventLifecycleService,
  ) {}

  @Get('lifecycle')
  async get(@Req() r: ApiRequest, @Param('orgId') org: string, @Param('eventId') id: string) {
    return envelope(r, await this.service.getLifecycle(r.headers.cookie, org, id));
  }

  @Post('lifecycle-commands')
  @HttpCode(200)
  async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.lifecycleCommand(r.headers.cookie, org, id, body));
  }
}
