import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '../errors.js';
import { CommerceService } from './service.js';
export const SCB_COMMERCE_SERVICE = 'SCB_COMMERCE_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/commerce')
export class CommerceCapabilitiesController {
  constructor(@Inject(SCB_COMMERCE_SERVICE) private readonly service: CommerceService) {}
  @Get('capabilities') async capabilities(@Req() r: ApiRequest) {
    return envelope(r, await this.service.capabilities(r.headers.cookie));
  }
}
@Controller('v1/orgs/:orgId/commerce')
export class OrgCommerceController {
  constructor(@Inject(SCB_COMMERCE_SERVICE) private readonly service: CommerceService) {}
  @Get() async workspace(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.service.workspace(r.headers.cookie, org));
  }
  @Post('orders') @HttpCode(200) async create(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createOrder(r.headers.cookie, org, body));
  }
  @Post('orders/:orderId/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('orderId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.buyerCommand(r.headers.cookie, org, id, body));
  }
}
@Controller('v1/platform/commerce')
export class PlatformCommerceController {
  constructor(@Inject(SCB_COMMERCE_SERVICE) private readonly service: CommerceService) {}
  @Get() async workspace(@Req() r: ApiRequest) {
    return envelope(r, await this.service.workspace(r.headers.cookie, undefined, true));
  }
  @Post('plans') @HttpCode(200) async plan(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.createPlan(r.headers.cookie, body));
  }
  @Post('plans/:planId/commands') @HttpCode(200) async planCommand(
    @Req() r: ApiRequest,
    @Param('planId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.planCommand(r.headers.cookie, id, body));
  }
  @Post('orders/:orderId/commands') @HttpCode(200) async order(
    @Req() r: ApiRequest,
    @Param('orderId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.platformCommand(r.headers.cookie, id, body));
  }
  @Post('reconciliations') @HttpCode(200) async reconcile(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.reconcile(r.headers.cookie, body));
  }
}
@Controller('v1/payments/wechat')
export class WechatPayNotificationController {
  constructor(@Inject(SCB_COMMERCE_SERVICE) private readonly service: CommerceService) {}
  @Post('notifications') @HttpCode(204) async notify(@Req() r: ApiRequest) {
    await this.service.notification(r.rawBody, r.headers);
  }
}
