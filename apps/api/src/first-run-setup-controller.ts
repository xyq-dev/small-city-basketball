import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { FirstRunSetupService } from './first-run-setup-service.js';
export const SCB_FIRST_RUN_SETUP = 'SCB_FIRST_RUN_SETUP';
@Controller('v1/setup')
export class FirstRunSetupController {
  constructor(@Inject(SCB_FIRST_RUN_SETUP) private readonly service: FirstRunSetupService) {}
  @Post('initialize')
  @HttpCode(200)
  async initialize(
    @Req() request: ApiRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const data = await this.service.initialize(
      body,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    return { data, meta: { requestId: request.requestId } };
  }
}
