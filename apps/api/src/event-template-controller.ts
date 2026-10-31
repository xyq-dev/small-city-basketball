import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { EventTemplateService } from './event-template-service.js';
export const SCB_EVENT_TEMPLATE_SERVICE = 'SCB_EVENT_TEMPLATE_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId')
export class EventTemplateController {
  constructor(@Inject(SCB_EVENT_TEMPLATE_SERVICE) private readonly service: EventTemplateService) {}
  @Get('event-templates') async catalog(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.service.listTemplates(r.headers.cookie, org));
  }
  @Post('event-template-commands') @HttpCode(200) async execute(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.executeTemplate(r.headers.cookie, org, body));
  }
  @Get('event-template-commands/:id') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
  ) {
    return envelope(r, await this.service.getTemplateReceipt(r.headers.cookie, org, id));
  }
  @Get('events/:eventId/setup-guide') async guide(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return envelope(r, await this.service.setupGuide(r.headers.cookie, org, id));
  }
}
