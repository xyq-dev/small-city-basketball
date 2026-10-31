import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { AccountRecoveryService } from './account-recovery-service.js';
export const SCB_ACCOUNT_RECOVERY = 'SCB_ACCOUNT_RECOVERY';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/account-recovery')
export class AccountRecoveryController {
  @Post('cancel') @HttpCode(200) async cancel(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.cancel(b, r.ip || r.socket.remoteAddress || 'unknown'));
  }
  constructor(@Inject(SCB_ACCOUNT_RECOVERY) private readonly service: AccountRecoveryService) {}
  @Get('capabilities') capabilities(@Req() r: ApiRequest) {
    return wrap(r, this.service.capabilities());
  }
  @Get('me') async me(@Req() r: ApiRequest) {
    return wrap(r, await this.service.me(r.headers.cookie));
  }
  @Post('reset-requests') @HttpCode(200) async reset(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.requestReset(b, r.ip || r.socket.remoteAddress || 'unknown'));
  }
  @Post('verification-requests') @HttpCode(200) async verification(
    @Req() r: ApiRequest,
    @Body() b: unknown,
  ) {
    return wrap(
      r,
      await this.service.requestVerification(
        r.headers.cookie,
        b,
        r.ip || r.socket.remoteAddress || 'unknown',
      ),
    );
  }
  @Post('consume') @HttpCode(200) async consume(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.consume(b, r.ip || r.socket.remoteAddress || 'unknown'));
  }
  @Post('receipts') @HttpCode(200) async receipt(@Req() r: ApiRequest, @Body() b: unknown) {
    return wrap(r, await this.service.receipt(b, r.ip || r.socket.remoteAddress || 'unknown'));
  }
}
