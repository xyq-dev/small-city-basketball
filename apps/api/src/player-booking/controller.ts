import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../errors.js';
import { PlayerBookingService } from './service.js';
export const SCB_PLAYER_BOOKING_SERVICE = 'SCB_PLAYER_BOOKING_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/player-bookings')
export class PlayerBookingController {
  constructor(@Inject(SCB_PLAYER_BOOKING_SERVICE) private readonly service: PlayerBookingService) {}
  @Get('workspace') async workspace(@Req() r: ApiRequest) {
    return envelope(r, await this.service.workspace(r.headers.cookie));
  }
  @Get('orders/:id') async getOrder(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.getOrder(r.headers.cookie, id));
  }
  @Put('profile') async profile(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.putProfile(r.headers.cookie, body));
  }
  @Post('profiles/:id/review') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.reviewProfile(r.headers.cookie, id, body));
  }
  @Put('settings') async settings(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.putSettings(r.headers.cookie, body));
  }
  @Post('orders') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.createOrder(r.headers.cookie, body));
  }
  @Post('orders/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.command(r.headers.cookie, id, body));
  }
}
