import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { PublicArchivesService } from './public-archives-service.js';
export const SCB_PUBLIC_ARCHIVES_SERVICE = 'SCB_PUBLIC_ARCHIVES_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1')
export class PublicArchivesController {
  constructor(
    @Inject(SCB_PUBLIC_ARCHIVES_SERVICE) private readonly service: PublicArchivesService,
  ) {}
  @Get('me/public-archives') async workspace(@Req() r: ApiRequest) {
    return envelope(r, await this.service.workspace(r.headers.cookie));
  }
  @Post('me/public-archives') @HttpCode(200) async create(
    @Req() r: ApiRequest,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.create(r.headers.cookie, b));
  }
  @Post('me/public-archives/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.command(r.headers.cookie, id, b));
  }
  @Get('orgs/:orgId/events/:eventId/public-archive-sources') async sources(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return envelope(r, await this.service.sources(r.headers.cookie, org, event));
  }
  @Post('public-archive-sources') @HttpCode(200) async nominate(
    @Req() r: ApiRequest,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.nominate(r.headers.cookie, b));
  }
  @Post('public-archive-sources/:id/commands') @HttpCode(200) async sourceCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.sourceCommand(r.headers.cookie, id, b));
  }
  @Get('public/archives/rankings') async rankings(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.rankings(q, r.ip || r.socket.remoteAddress || 'unknown'));
  }
  @Get('public/archives/:key') async profile(@Req() r: ApiRequest, @Param('key') key: string) {
    return envelope(
      r,
      await this.service.publicOne(key, r.ip || r.socket.remoteAddress || 'unknown'),
    );
  }
}
