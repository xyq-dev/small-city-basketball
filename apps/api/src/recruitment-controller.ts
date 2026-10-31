import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { RecruitmentService } from './recruitment-service.js';
export const SCB_RECRUITMENT_SERVICE = 'SCB_RECRUITMENT_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

@Controller('v1')
export class RecruitmentController {
  constructor(@Inject(SCB_RECRUITMENT_SERVICE) readonly service: RecruitmentService) {}
  @Get('orgs/:orgId/events/:eventId/recruitment') async workspace(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return envelope(r, await this.service.workspace(r.headers.cookie, org, event));
  }
  @Post('orgs/:orgId/events/:eventId/recruitment/publish') async publish(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.publish(r.headers.cookie, org, event, body));
  }
  @Post('orgs/:orgId/events/:eventId/recruitment/revoke') @HttpCode(200) async revoke(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revoke(r.headers.cookie, org, event, body));
  }
  @Get('public/recruitments/:publicId') async publicView(
    @Req() r: ApiRequest,
    @Param('publicId') id: string,
  ) {
    return envelope(
      r,
      await this.service.publicView(id, r.ip || r.socket.remoteAddress || 'unknown'),
    );
  }
  @Post('public/recruitments/:publicId/applications') async apply(
    @Req() r: ApiRequest,
    @Param('publicId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(
      r,
      await this.service.apply(
        r.headers.cookie,
        id,
        body,
        r.ip || r.socket.remoteAddress || 'unknown',
      ),
    );
  }
  @Get('orgs/:orgId/events/:eventId/recruitment-applications') async applications(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Query() query: unknown,
  ) {
    return envelope(r, await this.service.listApplications(r.headers.cookie, org, event, query));
  }
  @Post('orgs/:orgId/events/:eventId/recruitment-applications/:applicationId/commands')
  @HttpCode(200)
  async review(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Param('applicationId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.review(r.headers.cookie, org, event, id, body));
  }
  @Get('me/recruitment-applications') async mine(@Req() r: ApiRequest, @Query() query: unknown) {
    return envelope(r, await this.service.myApplications(r.headers.cookie, query));
  }
  @Post('orgs/:orgId/events/:eventId/team-import/previews') async preview(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.previewImport(r.headers.cookie, org, event, body));
  }
  @Post('orgs/:orgId/events/:eventId/team-import/commit') @HttpCode(200) async commit(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.commitImport(r.headers.cookie, org, event, body));
  }
  @Post('orgs/:orgId/events/:eventId/event-invitations') async invite(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.invite(r.headers.cookie, org, event, body));
  }
  @Get('orgs/:orgId/events/:eventId/event-invitations') async invitations(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Query() query: unknown,
  ) {
    return envelope(r, await this.service.invitations(r.headers.cookie, org, event, query));
  }
  @Get('me/event-invitations') async myInvitations(@Req() r: ApiRequest, @Query() query: unknown) {
    return envelope(r, await this.service.myInvitations(r.headers.cookie, query));
  }
  @Post('event-invitations/:invitationId/commands') @HttpCode(200) async decision(
    @Req() r: ApiRequest,
    @Param('invitationId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.invitationDecision(r.headers.cookie, id, body));
  }
  @Get('me/recruitment-requests/:clientRequestId') async receipt(
    @Req() r: ApiRequest,
    @Param('clientRequestId') id: string,
  ) {
    return envelope(r, await this.service.receipt(r.headers.cookie, id));
  }
}
