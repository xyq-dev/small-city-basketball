import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { EventPlayerStatisticsService } from './event-player-statistics-service.js';

export const SCB_EVENT_PLAYER_STATISTICS_SERVICE = 'SCB_EVENT_PLAYER_STATISTICS_SERVICE';

@Controller('v1/orgs/:orgId/events/:eventId')
export class EventPlayerStatisticsController {
  constructor(
    @Inject(SCB_EVENT_PLAYER_STATISTICS_SERVICE)
    private readonly service: EventPlayerStatisticsService,
  ) {}

  @Get('player-statistics')
  async get(@Req() r: ApiRequest, @Param('orgId') org: string, @Param('eventId') event: string) {
    return {
      data: await this.service.getPlayerStatistics(r.headers.cookie, org, event),
      meta: { requestId: r.requestId },
    };
  }
}
