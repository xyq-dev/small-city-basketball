import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from '../errors.js';
import { objectInput } from '../validation.js';
import { bookingFail } from './domain.js';
import { PlayerPerformanceService } from './performance-service.js';
export const SCB_PLAYER_PERFORMANCE_SERVICE = 'SCB_PLAYER_PERFORMANCE_SERVICE';
const envelope = <T>(request: ApiRequest, data: T) => ({
  data,
  meta: { requestId: request.requestId },
});
@Controller('v1/player-bookings')
export class PlayerPerformanceController {
  constructor(
    @Inject(SCB_PLAYER_PERFORMANCE_SERVICE) private readonly service: PlayerPerformanceService,
  ) {}
  @Get('players/performance') async batch(@Req() request: ApiRequest, @Query() raw: unknown) {
    const query = objectInput(raw, ['ids']);
    if (typeof query.ids !== 'string' || query.ids.length > 740)
      bookingFail('VALIDATION_ERROR', '请提供最多20位球员编号', 422);
    return envelope(
      request,
      await this.service.publicBatch(
        query.ids.split(','),
        request.ip || request.socket.remoteAddress || 'unknown',
      ),
    );
  }
  @Get('players/:id/performance') async one(
    @Req() request: ApiRequest,
    @Param('id') profileId: string,
  ) {
    return envelope(
      request,
      await this.service.publicOne(
        profileId,
        request.ip || request.socket.remoteAddress || 'unknown',
      ),
    );
  }
  @Get('performance/workspace') async workspace(@Req() request: ApiRequest) {
    return envelope(request, await this.service.workspace(request.headers.cookie));
  }
  @Get('performance/sources') async sources(@Req() request: ApiRequest, @Query() query: unknown) {
    return envelope(request, await this.service.sources(request.headers.cookie, query));
  }
  @Post('performance/links') @HttpCode(200) async nominate(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ) {
    return envelope(request, await this.service.nominate(request.headers.cookie, body));
  }
  @Post('performance/links/:id/commands') @HttpCode(200) async command(
    @Req() request: ApiRequest,
    @Param('id') linkId: string,
    @Body() body: unknown,
  ) {
    return envelope(request, await this.service.command(request.headers.cookie, linkId, body));
  }
}
