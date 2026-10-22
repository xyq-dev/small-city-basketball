import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { OverlayService } from './overlay-service.js';

export const SCB_OVERLAY_SERVICE = 'SCB_OVERLAY_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

@Controller('v1/orgs/:orgId/matches/:matchId')
export class OverlayController {
  constructor(@Inject(SCB_OVERLAY_SERVICE) private readonly service: OverlayService) {}

  @Get('overlay')
  async get(@Req() r: ApiRequest, @Param('orgId') org: string, @Param('matchId') match: string) {
    return envelope(r, await this.service.getWorkbench(r.headers.cookie, org, match));
  }

  @Post('overlay-commands')
  @HttpCode(200)
  async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.executeCommand(r.headers.cookie, org, match, body));
  }
}
