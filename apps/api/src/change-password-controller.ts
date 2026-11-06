import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { ChangePasswordService } from './change-password-service.js';
import { clearedSessionCookie } from './security.js';

export const SCB_CHANGE_PASSWORD = 'SCB_CHANGE_PASSWORD';

@Controller('v1/auth')
export class ChangePasswordController {
  constructor(@Inject(SCB_CHANGE_PASSWORD) private readonly service: ChangePasswordService) {}

  @Post('change-password')
  @HttpCode(200)
  async change(
    @Req() request: ApiRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.service.changePassword(
      request.headers.cookie,
      body,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    response.setHeader('Set-Cookie', clearedSessionCookie(this.service.secureCookies));
    return { data, meta: { requestId: request.requestId } };
  }
}
