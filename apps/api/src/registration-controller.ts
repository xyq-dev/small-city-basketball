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
import { RegistrationService } from './registration-service.js';

const envelope = <T>(request: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: request.requestId, ...extra },
});

@Controller('v1/orgs/:orgId')
export class RegistrationController {
  constructor(@Inject('SCB_APPLICATION_SERVICE') private readonly service: RegistrationService) {}
  @Get('teams')
  async teams(@Req() request: ApiRequest, @Param('orgId') org: string, @Query() query: unknown) {
    const result = await this.service.listTeams(request.headers.cookie, org, query);
    return envelope(request, result.data, {
      nextCursor: result.nextCursor,
      capabilities: result.capabilities,
    });
  }
  @Post('teams')
  async createTeam(@Req() request: ApiRequest, @Param('orgId') org: string, @Body() body: unknown) {
    return envelope(request, await this.service.createTeam(request.headers.cookie, org, body));
  }
  @Get('teams/:teamId')
  async team(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
  ) {
    return envelope(request, await this.service.getTeam(request.headers.cookie, org, team));
  }
  @Patch('teams/:teamId')
  async updateTeam(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.updateTeam(request.headers.cookie, org, team, body),
    );
  }
  @Put('teams/:teamId/members')
  async members(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.updateTeamMembers(request.headers.cookie, org, team, body),
    );
  }
  @Get('teams/:teamId/invitations')
  async invitations(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Query() query: unknown,
  ) {
    const result = await this.service.listInvitations(request.headers.cookie, org, team, query);
    return envelope(request, result.data, { nextCursor: result.nextCursor });
  }
  @Post('teams/:teamId/invitations')
  async createInvitation(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.createInvitation(request.headers.cookie, org, team, body),
    );
  }
  @Post('teams/:teamId/invitations/:invitationId/revoke')
  @HttpCode(200)
  async revokeInvitation(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('invitationId') invitation: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.revokeInvitation(request.headers.cookie, org, team, invitation, body),
    );
  }
  @Put('teams/:teamId/grants/:userId')
  async grant(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Param('userId') user: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.putTeamGrant(request.headers.cookie, org, team, user, body),
    );
  }
  @Get('teams/:teamId/registration-events')
  async registrationEvents(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('teamId') team: string,
    @Query() query: unknown,
  ) {
    const result = await this.service.teamRegistrationEvents(
      request.headers.cookie,
      org,
      team,
      query,
    );
    return envelope(request, result.data, { nextCursor: result.nextCursor });
  }
  @Get('events/:eventId/registration')
  async registration(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return envelope(
      request,
      await this.service.getRegistration(request.headers.cookie, org, event),
    );
  }
  @Put('events/:eventId/registration-rules')
  async rules(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.updateRules(request.headers.cookie, org, event, body),
    );
  }
  @Post('events/:eventId/registration-commands')
  @HttpCode(200)
  async registrationCommand(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.commandRegistration(request.headers.cookie, org, event, body),
    );
  }
  @Get('events/:eventId/entries')
  async entries(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Query() query: unknown,
  ) {
    const result = await this.service.listEntries(request.headers.cookie, org, event, query);
    return envelope(request, result.data, { nextCursor: result.nextCursor });
  }
  @Post('events/:eventId/entries')
  async createEntry(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.createEntry(request.headers.cookie, org, event, body),
    );
  }
  @Get('entries/:entryId')
  async entry(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
  ) {
    return envelope(request, await this.service.getEntry(request.headers.cookie, org, entry));
  }
  @Put('entries/:entryId/roster')
  async roster(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.updateRoster(request.headers.cookie, org, entry, body),
    );
  }
  @Post('entries/:entryId/commands')
  @HttpCode(200)
  async entryCommand(
    @Req() request: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.commandEntry(request.headers.cookie, org, entry, body),
    );
  }
}

@Controller('v1/invitations')
export class InvitationAcceptanceController {
  constructor(@Inject('SCB_APPLICATION_SERVICE') private readonly service: RegistrationService) {}
  @Post(':invitationId/accept')
  @HttpCode(200)
  async accept(
    @Req() request: ApiRequest,
    @Param('invitationId') invitation: string,
    @Body() body: unknown,
  ) {
    return envelope(
      request,
      await this.service.acceptInvitation(request.headers.cookie, invitation, body),
    );
  }
}
