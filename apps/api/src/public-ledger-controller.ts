import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { PublicLedgerService } from './public-ledger-service.js';
export const SCB_PUBLIC_LEDGER_SERVICE = 'SCB_PUBLIC_LEDGER_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/public-ledgers')
export class PublicLedgerController {
  constructor(@Inject(SCB_PUBLIC_LEDGER_SERVICE) private readonly service: PublicLedgerService) {}
  @Get('options') async options(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Query() q: unknown,
  ) {
    return envelope(r, await this.service.selectionOptions(r.headers.cookie, orgId, q));
  }
  @Get() async list(@Req() r: ApiRequest, @Param('orgId') orgId: string, @Query() q: unknown) {
    return envelope(r, await this.service.list(r.headers.cookie, orgId, q));
  }
  @Post() @HttpCode(200) async create(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.create(r.headers.cookie, orgId, body));
  }
  @Get(':id') async one(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return envelope(r, await this.service.get(r.headers.cookie, orgId, id));
  }
  @Post(':id/entries') @HttpCode(200) async add(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.addEntry(r.headers.cookie, orgId, id, body));
  }
  @Post(':id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.command(r.headers.cookie, orgId, id, body));
  }
}
@Controller('v1/public/ledgers')
export class PublicLedgerViewingController {
  constructor(@Inject(SCB_PUBLIC_LEDGER_SERVICE) private readonly service: PublicLedgerService) {}
  @Get(':key') async one(@Req() r: ApiRequest, @Param('key') key: string) {
    return envelope(r, await this.service.publicSnapshot(key));
  }
}
