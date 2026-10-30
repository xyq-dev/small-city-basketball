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
import { ParticipantMaterialsService } from './participant-materials-service.js';
export const SCB_PARTICIPANT_MATERIALS_SERVICE = 'SCB_PARTICIPANT_MATERIALS_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/orgs/:orgId/entries/:entryId/participant-materials')
export class ParticipantMaterialsController {
  constructor(
    @Inject(SCB_PARTICIPANT_MATERIALS_SERVICE)
    private readonly service: ParticipantMaterialsService,
  ) {}
  @Get('mine') async mine(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
  ) {
    return envelope(r, await this.service.getMine(r.headers.cookie, org, entry));
  }
  @Put('mine') async save(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.save(r.headers.cookie, org, entry, b));
  }
  @Get('mine/receipts/:clientRequestId') async receipt(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('clientRequestId') id: string,
  ) {
    return envelope(r, await this.service.receipt(r.headers.cookie, org, entry, id));
  }
  @Post('mine/submit') @HttpCode(200) async submit(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.submit(r.headers.cookie, org, entry, b));
  }
  @Post('mine/publicity-withdraw') @HttpCode(200) async withdraw(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.withdrawPublicity(r.headers.cookie, org, entry, b));
  }
  @Get() async list(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
  ) {
    return envelope(r, await this.service.list(r.headers.cookie, org, entry));
  }
  @Get(':memberId/private') async privateDetails(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('memberId') member: string,
  ) {
    return envelope(r, await this.service.privateDetails(r.headers.cookie, org, entry, member));
  }
  @Get(':memberId/files/:kind') async file(
    @Req() r: ApiRequest,
    @Res() res: Response,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('memberId') member: string,
    @Param('kind') kind: string,
  ) {
    const file = await this.service.file(r.headers.cookie, org, entry, member, kind);
    res.status(200);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${file.attachment ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
    );
    if (file.attachment) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(file.body);
  }
  @Post(':memberId/review') @HttpCode(200) async review(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('memberId') member: string,
    @Body() b: unknown,
  ) {
    return envelope(r, await this.service.review(r.headers.cookie, org, entry, member, b));
  }
  @Get(':memberId') async member(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('entryId') entry: string,
    @Param('memberId') member: string,
  ) {
    return envelope(r, await this.service.getMember(r.headers.cookie, org, entry, member));
  }
}
@Controller('v1/me/participant-entries')
export class ParticipantEntriesController {
  constructor(
    @Inject(SCB_PARTICIPANT_MATERIALS_SERVICE)
    private readonly service: ParticipantMaterialsService,
  ) {}
  @Get() async list(@Req() r: ApiRequest) {
    return envelope(r, await this.service.myEntries(r.headers.cookie));
  }
}
