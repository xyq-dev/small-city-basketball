import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { NotificationService } from './notification-service.js';
export const SCB_NOTIFICATIONS = 'SCB_NOTIFICATIONS';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/me/notifications')
export class NotificationController {
  constructor(@Inject(SCB_NOTIFICATIONS) readonly service: NotificationService) {}
  @Get('settings') async settings(@Req() r: ApiRequest) {
    return wrap(r, await this.service.settings(r.headers.cookie));
  }
  @Post('intents') @HttpCode(200) async intent(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.createIntent(r.headers.cookie, b));
  }
  @Get('intents/:id') async lookup(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.intent(r.headers.cookie, id));
  }
  @Post('confirmations') @HttpCode(200) async confirm(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.confirm(r.headers.cookie, b));
  }
  @Post('subscriptions/revoke') @HttpCode(200) async revoke(
    @Req() r: ApiRequest,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.revoke(r.headers.cookie, b));
  }
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return wrap(r, await this.service.list(r.headers.cookie, q));
  }
  @Post(':id/read') @HttpCode(200) async read(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.read(r.headers.cookie, id, b));
  }
  @Post(':id/retry') @HttpCode(200) async retry(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.retry(r.headers.cookie, id, b));
  }
}
