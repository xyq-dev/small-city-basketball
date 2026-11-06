import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../errors.js';
import { StorageSettingsService } from './service.js';
export const STORAGE_SETTINGS_SERVICE = 'SCB_STORAGE_SETTINGS_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/platform/storage')
export class PlatformStorageSettingsController {
  constructor(@Inject(STORAGE_SETTINGS_SERVICE) private readonly service: StorageSettingsService) {}
  @Get() async snapshot(@Req() r: ApiRequest) {
    return envelope(r, await this.service.snapshot(r.headers.cookie));
  }
  @Put('draft') async save(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.saveDraft(r.headers.cookie, body));
  }
  @Post('tests') @HttpCode(200) async test(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.testConnection(r.headers.cookie, body));
  }
  @Post('activation') @HttpCode(200) async activate(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.activate(r.headers.cookie, body));
  }
  @Get('operations/:commandId') async operation(
    @Req() r: ApiRequest,
    @Param('commandId') id: string,
  ) {
    return envelope(r, await this.service.operation(r.headers.cookie, id));
  }
}
