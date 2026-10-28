import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { invalid } from './validation.js';
import { TeamMembershipService } from './team-membership-service.js';
export const SCB_TEAM_MEMBERSHIP_SERVICE = 'SCB_TEAM_MEMBERSHIP_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
// Express resolves the client address through the configured `trust proxy` hops only.
const clientIp = (r: ApiRequest) => r.ip || r.socket.remoteAddress || 'unknown';

/** C19 §3 routes (docs/design/C19_CONTRACTS.md). Every route re-authorizes server-side. */
@Controller('v1')
export class TeamMembershipController {
  constructor(@Inject(SCB_TEAM_MEMBERSHIP_SERVICE) readonly service: TeamMembershipService) {}

  // ---------- organization OWNER/ADMIN: share links and review ----------
  @Post('orgs/:orgId/team-request-links') async createLink(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createRequestLink(r.headers.cookie, org, body));
  }
  @Get('orgs/:orgId/team-request-links') async links(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.listRequestLinks(r.headers.cookie, org));
  }
  @Post('orgs/:orgId/team-request-links/:linkId/revoke') @HttpCode(200) async revokeLink(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('linkId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revokeRequestLink(r.headers.cookie, org, id, body));
  }
  @Get('orgs/:orgId/team-requests') async orgRequests(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Query() query: unknown,
  ) {
    return envelope(r, await this.service.orgTeamRequests(r.headers.cookie, org, query));
  }
  @Post('orgs/:orgId/team-requests/:requestId/review') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('requestId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.reviewTeamRequest(r.headers.cookie, org, id, body));
  }

  // ---------- applicant ----------
  @Post('team-request-links/resolve') @HttpCode(200) async resolve(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.resolveRequestLink(r.headers.cookie, clientIp(r), body));
  }
  /** First submission 201; a replay of the same clientRequestId 200 with the same request. */
  @Post('team-requests') async submit(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await this.service.submitTeamRequest(r.headers.cookie, clientIp(r), body);
    res.status(result.created ? 201 : 200);
    return envelope(r, result.data);
  }
  @Get('me/team-requests') async mine(
    @Req() r: ApiRequest,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.myTeamRequests(r.headers.cookie));
  }
  @Post('me/team-requests/:requestId/withdraw') @HttpCode(200) async withdraw(
    @Req() r: ApiRequest,
    @Param('requestId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.withdrawTeamRequest(r.headers.cookie, id, body));
  }

  // ---------- team managers: join codes, bindings, claims ----------
  @Post('orgs/:orgId/teams/:teamId/join-codes') async createCode(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createJoinCode(r.headers.cookie, org, team, body));
  }
  @Get('orgs/:orgId/teams/:teamId/join-codes') async codes(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.listJoinCodes(r.headers.cookie, org, team));
  }
  @Post('orgs/:orgId/teams/:teamId/join-codes/:codeId/revoke') @HttpCode(200) async revokeCode(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('codeId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revokeJoinCode(r.headers.cookie, org, team, id, body));
  }
  @Get('orgs/:orgId/teams/:teamId/member-bindings') async bindings(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.memberBindings(r.headers.cookie, org, team));
  }
  @Post('orgs/:orgId/teams/:teamId/member-bindings/:bindingId/remove')
  @HttpCode(200)
  async remove(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('bindingId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.removeBinding(r.headers.cookie, org, team, id, body));
  }
  @Post('orgs/:orgId/teams/:teamId/members/:memberId/claims') async claim(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('memberId') member: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.createClaim(r.headers.cookie, org, team, member, body));
  }
  @Post('orgs/:orgId/teams/:teamId/member-claims/:claimId/revoke')
  @HttpCode(200)
  async revokeClaim(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('claimId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revokeClaim(r.headers.cookie, org, team, id, body));
  }

  // ---------- players: join, own memberships and claims ----------
  /** First join 201; a repeated join 200 with the original binding (no use consumed). */
  @Post('team-joins') async join(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await this.service.joinTeam(r.headers.cookie, clientIp(r), body);
    res.status(result.created ? 201 : 200);
    return envelope(r, result.data);
  }
  @Get('me/memberships') async memberships(
    @Req() r: ApiRequest,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.myMemberships(r.headers.cookie));
  }
  @Get('me/memberships/:bindingId/team') async membershipTeam(
    @Req() r: ApiRequest,
    @Param('bindingId') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.membershipTeam(r.headers.cookie, id));
  }
  @Post('me/memberships/:bindingId/leave') @HttpCode(200) async leave(
    @Req() r: ApiRequest,
    @Param('bindingId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.leaveMembership(r.headers.cookie, id, body));
  }
  @Get('me/member-claims') async myClaims(
    @Req() r: ApiRequest,
    @Query() query: Record<string, unknown>,
  ) {
    noQuery(query);
    return envelope(r, await this.service.myClaims(r.headers.cookie));
  }
  @Post('me/member-claims/:claimId/accept') @HttpCode(200) async accept(
    @Req() r: ApiRequest,
    @Param('claimId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.decideClaim(r.headers.cookie, id, 'accept', body));
  }
  @Post('me/member-claims/:claimId/decline') @HttpCode(200) async decline(
    @Req() r: ApiRequest,
    @Param('claimId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.decideClaim(r.headers.cookie, id, 'decline', body));
  }
}

function noQuery(query: Record<string, unknown>) {
  if (query && Object.keys(query).length) invalid('不支持的查询参数');
}
