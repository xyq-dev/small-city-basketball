import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { AccountClosureService } from './account-closure-service.js';
export const SCB_ACCOUNT_CLOSURE = 'SCB_ACCOUNT_CLOSURE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/account-closure')
export class AccountClosureController {
  constructor(@Inject(SCB_ACCOUNT_CLOSURE) private readonly service: AccountClosureService) {}
  @Get('capabilities') capabilities(@Req() r: ApiRequest) {
    return wrap(r, this.service.capabilities());
  }
  @Get('me') async me(@Req() r: ApiRequest) {
    return wrap(r, await this.service.workspace(r.headers.cookie));
  }
  @Post('requests') @HttpCode(200) async request(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.request(r.headers.cookie, b));
  }
  @Post('cancel') @HttpCode(200) async cancel(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.cancel(r.headers.cookie, b));
  }
}
