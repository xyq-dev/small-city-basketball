import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { PosterService } from './poster-service.js';
export const SCB_POSTER_SERVICE = 'SCB_POSTER_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/events/:eventId/posters')
export class PosterController {
  constructor(@Inject(SCB_POSTER_SERVICE) readonly service: PosterService) {}
  @Get() async workspace(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
  ) {
    return envelope(r, await this.service.workspace(r.headers.cookie, org, event));
  }
  @Post() async generate(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.generate(r.headers.cookie, org, event, body));
  }
  @Get(':exportId/content') async download(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Param('exportId') id: string,
    @Res() res: Response,
  ) {
    const file = await this.service.download(r.headers.cookie, org, event, id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.bytes);
  }
  @Post(':exportId/revoke') @HttpCode(200) async revoke(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('eventId') event: string,
    @Param('exportId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revoke(r.headers.cookie, org, event, id, body));
  }
}
