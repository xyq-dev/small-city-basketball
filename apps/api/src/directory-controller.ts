import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { DirectoryService } from './directory-service.js';
export const SCB_DIRECTORY_SERVICE = 'SCB_DIRECTORY_SERVICE';
const envelope = <T>(r: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: r.requestId, ...extra },
});

@Controller('v1/orgs/:orgId/events/:eventId')
export class DirectoryController {
  constructor(@Inject(SCB_DIRECTORY_SERVICE) private readonly service: DirectoryService) {}
  @Get('directory') async get(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
  ) {
    return envelope(r, await this.service.getDirectory(r.headers.cookie, org, id));
  }
  @Post('directory-commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.directoryCommand(r.headers.cookie, org, id, raw));
  }
}

/** Anonymous: never reads the Cookie header and never sets one. */
@Controller('v1/public/directory')
export class PublicDirectoryController {
  constructor(@Inject(SCB_DIRECTORY_SERVICE) private readonly service: DirectoryService) {}
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    const result = await this.service.getPublicDirectory(
      q,
      r.ip || r.socket.remoteAddress || 'unknown',
    );
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
}
