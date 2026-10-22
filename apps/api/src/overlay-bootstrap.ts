import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { OverlayService } from './overlay-service.js';
import { SCB_OVERLAY_SERVICE } from './overlay-controller.js';

const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

/** This controller deliberately never invokes private user/session authorization. */
@Controller('v1/overlays/:overlayId')
export class OverlaySourceController {
  constructor(@Inject(SCB_OVERLAY_SERVICE) private readonly service: OverlayService) {}

  @Post('bootstrap')
  @HttpCode(200)
  async bootstrap(
    @Req() r: ApiRequest,
    @Param('overlayId') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.bootstrap(id, body, r.headers.cookie);
    response.setHeader('Set-Cookie', result.cookie);
    return envelope(r, result.data);
  }

  @Get('snapshot')
  async snapshot(@Req() r: ApiRequest, @Param('overlayId') id: string) {
    return envelope(r, await this.service.getSnapshot(id, r.headers.cookie));
  }
}
