import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { DispatchService } from './dispatch-service.js';
export const SCB_DISPATCH_SERVICE = 'SCB_DISPATCH_SERVICE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/dispatch')
export class DispatchController {
  constructor(@Inject(SCB_DISPATCH_SERVICE) private readonly service: DispatchService) {}
  @Get('capabilities') capabilities(@Req() r: ApiRequest) {
    return wrap(r, this.service.capabilities());
  }
  @Get() async workspace(@Req() r: ApiRequest) {
    return wrap(r, await this.service.workspace(r.headers.cookie));
  }
  @Post('preferences') @HttpCode(200) async preference(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.preference(r.headers.cookie, b));
  }
  @Post('requests') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.create(r.headers.cookie, b));
  }
  @Get('requests/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.detail(r.headers.cookie, id));
  }
  @Post('requests/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.requestCommand(r.headers.cookie, id, b));
  }
  @Get('offers/:id') async offer(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.offerDetail(r.headers.cookie, id));
  }
  @Post('offers/:id/commands') @HttpCode(200) async offerCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return wrap(r, await this.service.offerCommand(r.headers.cookie, id, b));
  }
  @Get('receipts/:id') async receipt(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.receipt(r.headers.cookie, id));
  }
}
