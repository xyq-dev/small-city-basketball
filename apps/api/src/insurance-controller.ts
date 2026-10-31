import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { InsuranceService } from './insurance-service.js';
import { QualificationPrecheckService } from './qualification-precheck-service.js';
export const SCB_INSURANCE_SERVICE = 'SCB_INSURANCE_SERVICE';
export const SCB_QUALIFICATION_PRECHECK_SERVICE = 'SCB_QUALIFICATION_PRECHECK_SERVICE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/insurance')
export class InsuranceController {
  constructor(@Inject(SCB_INSURANCE_SERVICE) private readonly service: InsuranceService) {}
  @Get('capabilities') capabilities(@Req() r: ApiRequest) {
    return wrap(r, this.service.capabilities());
  }
  @Get() async workspace(@Req() r: ApiRequest) {
    return wrap(r, await this.service.workspace(r.headers.cookie));
  }
  @Post('quotes') @HttpCode(200) async quote(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.quote(r.headers.cookie, b));
  }
  @Post('purchases') @HttpCode(200) async purchase(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.purchase(r.headers.cookie, b));
  }
  @Get('requests/:id') async receipt(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.requestReceipt(r.headers.cookie, id));
  }
  @Get('orders/:id') async order(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.get(r.headers.cookie, id));
  }
  @Post('orders/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.command(r.headers.cookie, id, b));
  }
  @Get('orders/:id/checkout') async checkout(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.checkout(r.headers.cookie, id));
  }
  @Get('orders/:id/document') async document(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const f = await this.service.document(r.headers.cookie, id);
    response.setHeader('Content-Type', f.contentType);
    response.setHeader('Content-Disposition', 'attachment; filename="insurance-policy.pdf"');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(f.body);
  }
  @Post('provider-notices') @HttpCode(200) async notice(
    @Req() r: ApiRequest,
    @Body() b: unknown,
    @Headers('x-scb-insurance-signature') signature: unknown,
  ) {
    return wrap(r, await this.service.providerNotice(b, signature));
  }
}
@Controller('v1/orgs/:orgId/entries/:entryId/qualification-precheck')
export class QualificationPrecheckController {
  constructor(
    @Inject(SCB_QUALIFICATION_PRECHECK_SERVICE)
    private readonly service: QualificationPrecheckService,
  ) {}
  @Get() async workspace(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
  ) {
    return wrap(r, await this.service.workspace(r.headers.cookie, org, entry));
  }
  @Post('requests') @HttpCode(200) async request(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.request(r.headers.cookie, org, entry, b));
  }
  @Post('reviews') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.review(r.headers.cookie, org, entry, b));
  }
  @Get('requests/:id/receipt') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('id') id: string,
  ) {
    return wrap(r, await this.service.requestReceipt(r.headers.cookie, org, entry, id));
  }
}
