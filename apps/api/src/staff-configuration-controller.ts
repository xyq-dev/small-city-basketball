import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { StaffConfigurationService } from './staff-configuration-service.js';
export const SCB_STAFF_CONFIGURATION = 'SCB_STAFF_CONFIGURATION';
@Controller('v1/orgs/:orgId/staff-configuration')
export class StaffConfigurationController {
  constructor(
    @Inject(SCB_STAFF_CONFIGURATION) private readonly service: StaffConfigurationService,
  ) {}
  @Get() async workspace(@Req() r: ApiRequest, @Param('orgId') org: string, @Query() q: unknown) {
    return {
      data: await this.service.workspace(r.headers.cookie, org, q),
      meta: { requestId: r.requestId },
    };
  }
  @Post('commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return {
      data: await this.service.command(r.headers.cookie, org, b),
      meta: { requestId: r.requestId },
    };
  }
}
