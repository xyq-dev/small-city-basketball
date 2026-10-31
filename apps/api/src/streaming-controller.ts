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
import { createReadStream } from 'node:fs';
import type { ApiRequest } from './errors.js';
import { mediaRange } from './media-domain.js';
import { StreamingService } from './streaming-service.js';
export const SCB_STREAMING_SERVICE = 'SCB_STREAMING_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
async function content(
  res: Response,
  load: () => Promise<{ path: string; byteLength: number; sha256: string }>,
  range?: string,
) {
  const value = await load(),
    bytes = mediaRange(range, value.byteLength);
  res.status(bytes.partial ? 206 : 200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(bytes.end - bytes.start + 1));
  res.setHeader('Content-Disposition', 'inline; filename="basketball-recording.mp4"');
  if (bytes.partial)
    res.setHeader('Content-Range', `bytes ${bytes.start}-${bytes.end}/${value.byteLength}`);
  const input = createReadStream(value.path, { start: bytes.start, end: bytes.end });
  // Revocation applies to an already-open full-game download as well as the next range request.
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void load()
      .catch(() => {
        input.destroy();
        res.destroy();
      })
      .finally(() => {
        checking = false;
      });
  }, 1000);
  timer.unref();
  const cleanup = () => {
    clearInterval(timer);
    input.destroy();
  };
  res.once('close', cleanup);
  input.once('error', () => res.destroy());
  input.pipe(res);
}
@Controller('v1/orgs/:orgId')
export class StreamingController {
  constructor(@Inject(SCB_STREAMING_SERVICE) private readonly streaming: StreamingService) {}
  @Get('streaming-channels') async channels(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.streaming.channels(r.headers.cookie, org));
  }
  @Post('streaming-channels/commands') @HttpCode(200) async channel(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.streaming.channelCommand(r.headers.cookie, org, b));
  }
  @Get('matches/:matchId/streaming') async workspace(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
  ) {
    return envelope(r, await this.streaming.workspace(r.headers.cookie, org, match));
  }
  @Post('matches/:matchId/streaming/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.streaming.command(r.headers.cookie, org, match, b));
  }
  @Get('matches/:matchId/streaming/receipts/:receiptId') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('receiptId') id: string,
  ) {
    return envelope(r, await this.streaming.receipt(r.headers.cookie, org, match, id));
  }
  @Get('broadcasts/:sessionId/media') async media(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('sessionId') session: string,
  ) {
    return envelope(r, await this.streaming.mediaWorkspace(r.headers.cookie, org, session));
  }
  @Post('broadcasts/:sessionId/media/commands') @HttpCode(200) async mediaCommand(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('sessionId') session: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.streaming.mediaCommand(r.headers.cookie, org, session, b));
  }
  @Get('broadcasts/:sessionId/media/artifacts/:artifactId/content') async artifact(
    @Req() r: ApiRequest,
    @Res() res: Response,
    @Param('orgId') org: string,
    @Param('sessionId') session: string,
    @Param('artifactId') id: string,
    @Headers('range') range?: string,
  ) {
    await content(res, () => this.streaming.artifact(r.headers.cookie, org, session, id), range);
  }
}
@Controller('v1/public/live-media')
export class PublicLiveMediaController {
  constructor(@Inject(SCB_STREAMING_SERVICE) private readonly streaming: StreamingService) {}
  @Get(':key/content') async artifact(
    @Res() res: Response,
    @Param('key') key: string,
    @Headers('range') range?: string,
  ) {
    await content(res, () => this.streaming.publicArtifact(key), range);
  }
}
