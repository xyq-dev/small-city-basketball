import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { SponsorshipService } from './sponsorship-service.js';
export const SCB_SPONSORSHIP_SERVICE = 'SCB_SPONSORSHIP_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/sponsorships')
export class SponsorshipController {
  constructor(@Inject(SCB_SPONSORSHIP_SERVICE) private readonly service: SponsorshipService) {}
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
    return envelope(r, await this.service.save(r.headers.cookie, orgId, null, body));
  }
  @Get(':id') async get(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return envelope(r, await this.service.get(r.headers.cookie, orgId, id));
  }
  @Put(':id') @HttpCode(200) async save(
    @Req() r: ApiRequest,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.save(r.headers.cookie, orgId, id, body));
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
@Controller('v1/me/sponsorships')
export class SponsorshipReviewController {
  constructor(@Inject(SCB_SPONSORSHIP_SERVICE) private readonly service: SponsorshipService) {}
  @Get('review-queue') async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.reviewQueue(r.headers.cookie, q));
  }
  @Post(':id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    const { objectInput } = await import('./validation.js');
    const { govId } = await import('./governance-domain.js');
    const o = objectInput(raw, ['orgId', 'commandId', 'expectedVersion', 'type', 'reason']);
    const { orgId, ...body } = o;
    return envelope(r, await this.service.command(r.headers.cookie, govId(orgId), id, body));
  }
}
@Controller('v1/public/sponsorships')
export class PublicSponsorshipController {
  constructor(@Inject(SCB_SPONSORSHIP_SERVICE) private readonly service: SponsorshipService) {}
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.publicList(q));
  }
  @Get(':key') async one(@Req() r: ApiRequest, @Param('key') key: string) {
    return envelope(r, await this.service.publicOne(key));
  }
  @Post(':key/impressions') @HttpCode(200) async report(
    @Req() r: ApiRequest,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.impression(key, body, r.ip ?? 'unknown'));
  }
}
