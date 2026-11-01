import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { SponsorCommerceService } from './sponsor-commerce-service.js';
export const SCB_SPONSOR_COMMERCE_SERVICE = 'SCB_SPONSOR_COMMERCE_SERVICE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/sponsor-commerce')
export class SponsorCommerceController {
  constructor(@Inject(SCB_SPONSOR_COMMERCE_SERVICE) private service: SponsorCommerceService) {}
  @Get('receipts/:commandId') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('commandId') id: string,
  ) {
    return wrap(r, await this.service.receipt(r.headers.cookie, org, id));
  }
  @Post('receipts/:commandId/cancel') @HttpCode(200) async cancelReceipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('commandId') id: string,
  ) {
    return wrap(r, await this.service.receipt(r.headers.cookie, org, id, true));
  }
  @Get() async list(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return wrap(r, await this.service.list(r.headers.cookie, org));
  }
  @Get('statements') async statements(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return wrap(r, await this.service.statements(r.headers.cookie, org));
  }
  @Post('beneficiaries') @HttpCode(200) async beneficiary(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.beneficiary(r.headers.cookie, org, b));
  }
  @Post('contracts') @HttpCode(200) async create(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.createContract(r.headers.cookie, org, b));
  }
  @Post('contracts/:id/commands') @HttpCode(200) async contract(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.contractCommand(r.headers.cookie, org, id, b));
  }
  @Post('orders') @HttpCode(200) async order(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.createOrder(r.headers.cookie, org, b));
  }
  @Get('orders/:id') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
  ) {
    return wrap(r, await this.service.get(r.headers.cookie, org, id));
  }
  @Post('orders/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.orderCommand(r.headers.cookie, org, id, b));
  }
  @Post('orders/:id/channel') @HttpCode(200) async channel(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.channel(r.headers.cookie, org, id, b));
  }
}
