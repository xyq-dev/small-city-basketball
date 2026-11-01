import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { MatchingService } from './matching-service.js';
export const SCB_MATCHING_SERVICE = 'SCB_MATCHING_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/matching')
export class MatchingController {
  constructor(@Inject(SCB_MATCHING_SERVICE) private readonly service: MatchingService) {}
  @Get() async workspace(@Req() r: ApiRequest) {
    return envelope(r, await this.service.workspace(r.headers.cookie));
  }
  @Get('receipts/:commandId') async receipt(@Req() r: ApiRequest, @Param('commandId') id: string) {
    return envelope(r, await this.service.receipt(r.headers.cookie, id));
  }
  @Post('preferences') @HttpCode(200) async preference(@Req() r: ApiRequest, @Body() raw: unknown) {
    return envelope(r, await this.service.setPreference(r.headers.cookie, raw));
  }
  @Post('needs') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() raw: unknown) {
    return envelope(r, await this.service.create(r.headers.cookie, raw));
  }
  @Get('needs/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.detail(r.headers.cookie, id));
  }
  @Post('needs/:id/runs') @HttpCode(200) async run(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.run(r.headers.cookie, id, raw));
  }
  @Post('needs/:id/intents') @HttpCode(200) async send(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.sendIntent(r.headers.cookie, id, raw));
  }
  @Post('needs/:id/commands') @HttpCode(200) async need(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.needCommand(r.headers.cookie, id, raw));
  }
  @Post('intents/:id/commands') @HttpCode(200) async intent(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.intentCommand(r.headers.cookie, id, raw));
  }
}
