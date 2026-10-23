import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { sessionCookie, clearedSessionCookie } from './security.js';
import { WechatService } from './wechat-service.js';
export const SCB_WECHAT_SERVICE = 'SCB_WECHAT_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
const ip = (r: ApiRequest) => r.ip || r.socket.remoteAddress || 'unknown';
@Controller('v1/auth/wechat')
export class WechatController {
  constructor(@Inject(SCB_WECHAT_SERVICE) private readonly service: WechatService) {}
  @Get('capabilities') capabilities(@Req() r: ApiRequest) {
    return envelope(r, this.service.capabilities());
  }
  @Get('binding') async binding(@Req() r: ApiRequest) {
    return envelope(r, await this.service.binding(r.headers.cookie));
  }
  @Post('challenges') @HttpCode(200) async challenge(@Req() r: ApiRequest, @Body() b: unknown) {
    return envelope(r, await this.service.challenge(r.headers.cookie, b, ip(r)));
  }
  @Post('bind') @HttpCode(200) async bind(@Req() r: ApiRequest, @Body() b: unknown) {
    return envelope(r, await this.service.bind(r.headers.cookie, b, ip(r)));
  }
  @Post('login') @HttpCode(200) async login(
    @Req() r: ApiRequest,
    @Body() b: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.wechatLogin(b, ip(r));
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, this.service.sessionTtlSeconds, this.service.secureCookies),
    );
    return envelope(r, result.data);
  }
  @Post('unbind') @HttpCode(200) async unbind(
    @Req() r: ApiRequest,
    @Body() b: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.unbind(r.headers.cookie, b, ip(r));
    response.setHeader('Set-Cookie', clearedSessionCookie(this.service.secureCookies));
    return envelope(r, result);
  }
}
