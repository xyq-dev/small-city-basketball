import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { MediaService } from './media-service.js';
export const SCB_MEDIA_SERVICE = 'SCB_MEDIA_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
function sendContent(
  response: Response,
  value: Awaited<ReturnType<MediaService['getPrivateContent']>>,
) {
  response.status(value.status);
  response.setHeader('Content-Type', value.contentType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Length', String(value.body.length));
  response.setHeader(
    'Content-Disposition',
    `${value.attachment ? 'attachment' : 'inline'}; filename="media-download"; filename*=UTF-8''${encodeURIComponent(value.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  );
  if (value.attachment)
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  if (value.contentRange) response.setHeader('Content-Range', value.contentRange);
  response.end(value.body);
}
@Controller('v1/orgs/:orgId')
export class MediaController {
  constructor(@Inject(SCB_MEDIA_SERVICE) private readonly media: MediaService) {}
  @Get('entries/:entryId/media-files') async entry(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') id: string,
  ) {
    return envelope(r, await this.media.getEntryFiles(r.headers.cookie, org, id));
  }
  @Post('entries/:entryId/media-files') async uploadEntry(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.upload(r.headers.cookie, org, id, 'ENTRY', b));
  }
  @Post('entries/:entryId/media-files/:fileId/commands') @HttpCode(200) async entryCommand(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') id: string,
    @Param('fileId') file: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.fileCommand(r.headers.cookie, org, id, 'ENTRY', file, b));
  }
  @Get('entries/:entryId/media-files/:fileId/content') async entryContent(
    @Req() r: ApiRequest,
    @Res() res: Response,
    @Param('orgId') org: string,
    @Param('entryId') id: string,
    @Param('fileId') file: string,
    @Headers('range') range?: string,
  ) {
    sendContent(
      res,
      await this.media.getPrivateContent(r.headers.cookie, org, id, 'ENTRY', file, range),
    );
  }
  @Get('matches/:matchId/media') async match(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
  ) {
    return envelope(r, await this.media.getMatchMedia(r.headers.cookie, org, id));
  }
  @Post('matches/:matchId/media-files') async uploadMatch(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.upload(r.headers.cookie, org, id, 'MATCH', b));
  }
  @Post('matches/:matchId/media-files/:fileId/commands') @HttpCode(200) async matchFileCommand(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('fileId') file: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.fileCommand(r.headers.cookie, org, id, 'MATCH', file, b));
  }
  @Get('matches/:matchId/media-files/:fileId/content') async matchContent(
    @Req() r: ApiRequest,
    @Res() res: Response,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('fileId') file: string,
    @Headers('range') range?: string,
  ) {
    sendContent(
      res,
      await this.media.getPrivateContent(r.headers.cookie, org, id, 'MATCH', file, range),
    );
  }
  @Post('matches/:matchId/media') async create(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.createMedia(r.headers.cookie, org, id, b));
  }
  @Post('matches/:matchId/media/:mediaId/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('mediaId') media: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.mediaCommand(r.headers.cookie, org, id, media, b));
  }
  @Post('matches/:matchId/media/:mediaId/markers') async marker(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') id: string,
    @Param('mediaId') media: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.media.createMarker(r.headers.cookie, org, id, media, b));
  }
}
@Controller('v1/public/events/:publicEventId/matches/:publicMatchId/media')
export class PublicMediaController {
  constructor(@Inject(SCB_MEDIA_SERVICE) private readonly media: MediaService) {}
  @Get() async list(
    @Req() r: ApiRequest,
    @Param('publicEventId') event: string,
    @Param('publicMatchId') match: string,
  ) {
    return envelope(r, await this.media.getPublicMedia(event, match));
  }
  @Get(':publicMediaId/content') async content(
    @Res() res: Response,
    @Param('publicEventId') event: string,
    @Param('publicMatchId') match: string,
    @Param('publicMediaId') media: string,
    @Headers('range') range?: string,
  ) {
    sendContent(res, await this.media.getPublicContent(event, match, media, range));
  }
}
