import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { TradeService } from './trade-service.js';
export const SCB_TRADE_SERVICE = 'SCB_TRADE_SERVICE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/trades')
export class TradeController {
  constructor(@Inject(SCB_TRADE_SERVICE) private service: TradeService) {}
  @Post('preview') @HttpCode(200) async preview(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.preview(r.headers.cookie, b));
  }
  @Post('quote') @HttpCode(200) async quote(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.quote(r.headers.cookie, b));
  }
  @Get('source') async source(
    @Req() r: ApiRequest,
    @Query('kind') kind: string,
    @Query('sourceId') id: string,
  ) {
    return wrap(r, await this.service.sourceOrder(r.headers.cookie, kind, id));
  }
  @Get('orders') async list(@Req() r: ApiRequest, @Query('orgId') org?: string) {
    return wrap(r, await this.service.list(r.headers.cookie, org));
  }
  @Post('orders') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.create(r.headers.cookie, b));
  }
  @Get('receipts/:commandId') async receipt(@Req() r: ApiRequest, @Param('commandId') id: string) {
    return wrap(r, await this.service.receipt(r.headers.cookie, id));
  }
  @Get('orders/:id') async get(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.get(r.headers.cookie, id));
  }
  @Post('orders/:id/payments') @HttpCode(200) async pay(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.pay(r.headers.cookie, id, b));
  }
  @Post('orders/:id/payments/:attemptId/query') @HttpCode(200) async queryPayment(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('attemptId') child: string,
  ) {
    return wrap(r, await this.service.queryPayment(r.headers.cookie, id, child));
  }
  @Post('orders/:id/refunds') @HttpCode(200) async refund(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.requestRefund(r.headers.cookie, id, b));
  }
  @Post('orders/:id/deductions') @HttpCode(200) async deduction(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.proposeDeduction(r.headers.cookie, id, b));
  }
  @Post('orders/:id/settlements') @HttpCode(200) async settlement(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.proposeSettlement(r.headers.cookie, id, b));
  }
  @Post('orders/:id/reviews/:kind/:childId') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('childId') child: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.review(r.headers.cookie, id, kind, child, b));
  }
  @Post('orders/:id/refunds/:childId/dispatch') @HttpCode(200) async dispatchRefund(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.dispatchRefund(r.headers.cookie, id, child, b));
  }
  @Post('orders/:id/refunds/:childId/query') @HttpCode(200) async queryRefund(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
  ) {
    return wrap(r, await this.service.queryRefund(r.headers.cookie, id, child));
  }
  @Post('orders/:id/settlements/:childId/dispatch') @HttpCode(200) async dispatchSettlement(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.dispatchSettlement(r.headers.cookie, id, child, b));
  }
  @Post('orders/:id/settlements/:childId/query') @HttpCode(200) async querySettlement(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
  ) {
    return wrap(r, await this.service.querySettlement(r.headers.cookie, id, child));
  }
  @Post('orders/:id/settlements/:childId/return') @HttpCode(200) async returnSettlement(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.returnSettlement(r.headers.cookie, id, child, b));
  }
  @Post('orders/:id/settlements/:childId/return-query') @HttpCode(200) async queryReturn(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('childId') child: string,
  ) {
    return wrap(r, await this.service.queryReturn(r.headers.cookie, id, child));
  }
  @Get('orgs/:orgId/terms') async terms(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return wrap(r, await this.service.terms(r.headers.cookie, org));
  }
  @Post('orgs/:orgId/terms') @HttpCode(200) async createTerms(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.createTerms(r.headers.cookie, org, b));
  }
  @Post('orgs/:orgId/terms/:termId/review') @HttpCode(200) async reviewTerms(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('termId') term: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.reviewTerms(r.headers.cookie, org, term, b));
  }
  @Post('orgs/:orgId/reconcile') @HttpCode(200) async reconcile(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.reconcile(r.headers.cookie, org, b));
  }
}
/** Provider signature auth, raw request bytes. Root must exempt only this path from session/CSRF guard. */
@Controller('v1/trade-notifications')
export class TradeNotificationController {
  constructor(@Inject(SCB_TRADE_SERVICE) private service: TradeService) {}
  @Post(':merchantKey') @HttpCode(200) async notify(
    @Req() r: ApiRequest & { rawBody?: Buffer },
    @Param('merchantKey') key: string,
  ) {
    if (!r.rawBody) throw new Error('Raw trade notification body missing');
    await this.service.notification(key, r.rawBody, r.headers);
    return { code: 'SUCCESS', message: '成功' };
  }
}
