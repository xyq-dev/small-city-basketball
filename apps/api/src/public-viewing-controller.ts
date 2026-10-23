import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { StandingsService } from './standings-service.js';
import { SCB_STANDINGS_SERVICE } from './standings-controller.js';
const envelope = <T>(r: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: r.requestId, ...extra },
});
@Controller('v1/public/events/:publicEventId')
export class PublicViewingController {
  constructor(@Inject(SCB_STANDINGS_SERVICE) private readonly service: StandingsService) {}
  @Get() async get(@Req() r: ApiRequest, @Param('publicEventId') id: string) {
    return envelope(r, await this.service.getPublicEvent(id));
  }
  @Get('schedule') async schedule(
    @Req() r: ApiRequest,
    @Param('publicEventId') id: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.getPublicSchedule(id, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
  @Get('standings') async standings(@Req() r: ApiRequest, @Param('publicEventId') id: string) {
    return envelope(r, await this.service.getPublicStandings(id));
  }
  @Get('knockout') async knockout(@Req() r: ApiRequest, @Param('publicEventId') id: string) {
    return envelope(r, await this.service.getPublicKnockout(id));
  }
  @Get('matches/:publicMatchId') async match(
    @Req() r: ApiRequest,
    @Param('publicEventId') id: string,
    @Param('publicMatchId') match: string,
  ) {
    return envelope(r, await this.service.getPublicMatch(id, match));
  }
}
