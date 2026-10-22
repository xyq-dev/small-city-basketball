import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { SchedulingService } from './scheduling-service.js';
export const SCB_SCHEDULING_SERVICE = 'SCB_SCHEDULING_SERVICE';
const envelope = <T>(request: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: request.requestId, ...extra },
});
@Controller('v1/orgs/:orgId')
export class SchedulingController {
  constructor(@Inject(SCB_SCHEDULING_SERVICE) private readonly service: SchedulingService) {}
  @Get('courts') async courts(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.listCourts(r.headers.cookie, org, q);
    return envelope(r, result.data, {
      nextCursor: result.nextCursor,
      capabilities: result.capabilities,
    });
  }
  @Post('courts') async createCourt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createCourt(r.headers.cookie, org, body));
  }
  @Patch('courts/:id') async updateCourt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.updateCourt(r.headers.cookie, org, id, body));
  }
  @Get('events/:eventId/scheduling') async scheduling(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return envelope(r, await this.service.getScheduling(r.headers.cookie, org, id));
  }
  @Post('events/:eventId/schedule-revisions') async createRevision(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createRevision(r.headers.cookie, org, id, body));
  }
  @Get('schedule-revisions/:id') async revision(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
  ) {
    return envelope(r, await this.service.getRevision(r.headers.cookie, org, id));
  }
  @Put('schedule-revisions/:id/allocations') async allocations(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.updateAllocations(r.headers.cookie, org, id, body));
  }
  @Post('schedule-revisions/:id/validate') @HttpCode(200) async validate(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.validateRevision(r.headers.cookie, org, id, body));
  }
  @Post('schedule-revisions/:id/publish') @HttpCode(200) async publish(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.publishRevision(r.headers.cookie, org, id, body));
  }
  @Get('events/:eventId/matches') async matches(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Query() q: unknown,
  ) {
    const result = await this.service.listMatches(r.headers.cookie, org, id, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
}
