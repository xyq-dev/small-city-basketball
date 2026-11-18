import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../errors.js';
import { LocationSettingsService } from './service.js';

export const LOCATION_SETTINGS_SERVICE = 'SCB_LOCATION_SETTINGS_SERVICE';
const envelope = <T>(request: ApiRequest, data: T) => ({
  data,
  meta: { requestId: request.requestId },
});

@Controller('v1/platform/location')
export class PlatformLocationSettingsController {
  constructor(
    @Inject(LOCATION_SETTINGS_SERVICE) private readonly service: LocationSettingsService,
  ) {}
  @Get() async snapshot(@Req() request: ApiRequest) {
    return envelope(request, await this.service.snapshot(request.headers.cookie));
  }
  @Put('draft') async save(@Req() request: ApiRequest, @Body() body: unknown) {
    return envelope(request, await this.service.saveDraft(request.headers.cookie, body));
  }
  @Post('tests') @HttpCode(200) async test(@Req() request: ApiRequest, @Body() body: unknown) {
    return envelope(request, await this.service.testConnection(request.headers.cookie, body));
  }
  @Post('activation') @HttpCode(200) async activate(
    @Req() request: ApiRequest,
    @Body() body: unknown,
  ) {
    return envelope(request, await this.service.activate(request.headers.cookie, body));
  }
  @Post('disable') @HttpCode(200) async disable(@Req() request: ApiRequest, @Body() body: unknown) {
    return envelope(request, await this.service.disable(request.headers.cookie, body));
  }
  @Get('operations/:commandId') async operation(
    @Req() request: ApiRequest,
    @Param('commandId') id: string,
  ) {
    return envelope(request, await this.service.operation(request.headers.cookie, id));
  }
}
