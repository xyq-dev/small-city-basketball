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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { YouthGuardiansService } from './youth-guardians-service.js';
export const SCB_YOUTH_GUARDIANS_SERVICE = 'SCB_YOUTH_GUARDIANS_SERVICE';
const wrap = (r: ApiRequest, data: unknown) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1')
export class YouthGuardiansController {
  constructor(
    @Inject(SCB_YOUTH_GUARDIANS_SERVICE) private readonly service: YouthGuardiansService,
  ) {}
  @Get('me/youth-guardians') async mine(@Req() r: ApiRequest, @Query() q: unknown) {
    return wrap(r, await this.service.workspace(r.headers.cookie, q));
  }
  @Get('me/youth-guardian-commands/:id') async receipt(
    @Req() r: ApiRequest,
    @Param('id') id: string,
  ) {
    return wrap(r, await this.service.receipt(r.headers.cookie, id));
  }
  @Get('orgs/:orgId/events/:eventId/youth-adult-data-consent') async adultCapability(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Query() q: unknown,
  ) {
    return wrap(r, await this.service.adultCapability(r.headers.cookie, org, event, q));
  }
  @Post('orgs/:orgId/events/:eventId/youth-adult-data-consent') @HttpCode(200) async adultCommand(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.adultDataCommand(r.headers.cookie, org, event, body));
  }
  @Get('orgs/:orgId/events/:eventId/youth-policy') async policy(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return wrap(r, await this.service.policy(r.headers.cookie, org, event));
  }
  @Put('orgs/:orgId/events/:eventId/youth-policy') async configure(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.setPolicy(r.headers.cookie, org, event, body));
  }
  @Post('orgs/:orgId/events/:eventId/youth-data-invitations') @HttpCode(200) async invite(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.inviteData(r.headers.cookie, org, event, body));
  }
  @Post('youth-data-invitations/:id/commands') @HttpCode(200) async dataCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.dataDecision(r.headers.cookie, id, body));
  }
  @Post('orgs/:orgId/events/:eventId/youth-guardian-requests') @HttpCode(200) async propose(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.propose(r.headers.cookie, org, event, body));
  }
  @Get('orgs/:orgId/events/:eventId/youth-guardian-requests') async reviewQueue(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Query() q: unknown,
  ) {
    return wrap(r, await this.service.reviewQueue(r.headers.cookie, org, event, q));
  }
  @Get('youth-guardian-requests/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return wrap(r, await this.service.detail(r.headers.cookie, id));
  }
  @Post('youth-guardian-requests/:id/confirm') @HttpCode(200) async confirm(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.guardianConfirm(r.headers.cookie, id, body));
  }
  @Post('youth-guardian-requests/:id/review') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.review(r.headers.cookie, id, body));
  }
  @Post('youth-guardian-requests/:id/withdraw') @HttpCode(200) async withdraw(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.withdraw(r.headers.cookie, id, body));
  }
  @Post('youth-guardian-requests/:id/purge') @HttpCode(200) async purge(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return wrap(r, await this.service.purgeProof(r.headers.cookie, id, body));
  }
  @Get('youth-guardian-requests/:id/private') async privateData(
    @Req() r: ApiRequest,
    @Param('id') id: string,
  ) {
    return wrap(r, await this.service.privateData(r.headers.cookie, id));
  }
  @Get('youth-guardian-requests/:id/proof') async proof(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.service.proofFile(r.headers.cookie, id);
    res.status(200);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', file.body.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${file.attachment ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
    );
    if (file.attachment) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(file.body);
  }
}
