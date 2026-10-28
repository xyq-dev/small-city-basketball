import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { MediaRequestService } from './media-request-service.js';
import type { Created } from './media-request-service.js';
export const SCB_MEDIA_REQUEST_SERVICE = 'SCB_MEDIA_REQUEST_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
/** First execution 201, legal replay of the same request 200. */
const created = <T>(r: ApiRequest, res: Response, value: Created<T>) => {
  res.status(value.created ? 201 : 200);
  return envelope(r, value.data);
};

/** C19 §2 (docs/design/C19_CONTRACTS.md): match media request identity and upload sessions. */
@Controller('v1/orgs/:orgId/matches/:matchId')
export class MediaRequestController {
  constructor(@Inject(SCB_MEDIA_REQUEST_SERVICE) readonly service: MediaRequestService) {}
  @Post('media-file-requests') async uploadFile(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Body() body: unknown,
  ) {
    return created(
      r,
      res,
      await this.service.uploadFileRequest(r.headers.cookie, org, match, body),
    );
  }
  @Get('media-file-requests/:clientRequestId') async fileReceipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('clientRequestId') id: string,
  ) {
    return envelope(r, await this.service.fileReceipt(r.headers.cookie, org, match, id));
  }
  @Post('media-requests') async createMedia(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Body() body: unknown,
  ) {
    return created(
      r,
      res,
      await this.service.createMediaRequest(r.headers.cookie, org, match, body),
    );
  }
  @Get('media-requests/:clientRequestId') async mediaReceipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('clientRequestId') id: string,
  ) {
    return envelope(r, await this.service.mediaReceipt(r.headers.cookie, org, match, id));
  }
  @Post('media-upload-sessions') async createSession(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Body() body: unknown,
  ) {
    return created(
      r,
      res,
      await this.service.createUploadSession(r.headers.cookie, org, match, body),
    );
  }
  @Get('media-upload-sessions/:sessionId') async session(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('sessionId') id: string,
  ) {
    return envelope(r, await this.service.getUploadSession(r.headers.cookie, org, match, id));
  }
  @Put('media-upload-sessions/:sessionId/chunks/:index') async chunk(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('sessionId') id: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.putChunk(r.headers.cookie, org, match, id, index, body));
  }
  @Post('media-upload-sessions/:sessionId/complete') @HttpCode(200) async complete(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('sessionId') id: string,
  ) {
    return envelope(r, await this.service.completeUploadSession(r.headers.cookie, org, match, id));
  }
  @Post('media-upload-sessions/:sessionId/cancel') @HttpCode(200) async cancel(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('matchId') match: string,
    @Param('sessionId') id: string,
  ) {
    return envelope(r, await this.service.cancelUploadSession(r.headers.cookie, org, match, id));
  }
}
