import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiRequest } from './errors.js';
import { GovernanceService } from './governance-service.js';
import { CityOperationsService } from './city-operations-service.js';
export const SCB_GOVERNANCE_SERVICE = 'SCB_GOVERNANCE_SERVICE';
export const SCB_CITY_OPERATIONS_SERVICE = 'SCB_CITY_OPERATIONS_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });

@Controller('v1/me/governance')
export class GovernanceController {
  constructor(@Inject(SCB_GOVERNANCE_SERVICE) private readonly service: GovernanceService) {}
  @Get('operations/:commandId') async operation(
    @Req() r: ApiRequest,
    @Param('commandId') id: string,
  ) {
    return envelope(r, await this.service.operationReceipt(r.headers.cookie, id));
  }
  @Post('operations/:commandId/cancel') @HttpCode(200) async cancelOperation(
    @Req() r: ApiRequest,
    @Param('commandId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.cancelOperation(r.headers.cookie, id, body));
  }
  @Get('cases') async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.cases(r.headers.cookie, q));
  }
  @Post('cases') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.createCase(r.headers.cookie, body));
  }
  @Get('cases/:caseId') async one(@Req() r: ApiRequest, @Param('caseId') id: string) {
    return envelope(r, await this.service.getCase(r.headers.cookie, id));
  }
  @Get('cases/:caseId/assignees') async assignees(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
  ) {
    return envelope(r, await this.service.caseAssignees(r.headers.cookie, id));
  }
  @Get('cases/:caseId/messages') async messages(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Query() q: unknown,
  ) {
    return envelope(r, await this.service.caseMessages(r.headers.cookie, id, q));
  }
  @Post('cases/:caseId/messages') @HttpCode(200) async reply(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.reply(r.headers.cookie, id, body));
  }
  @Post('cases/:caseId/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.caseCommand(r.headers.cookie, id, body));
  }
  @Put('cases/:caseId/attachments/:clientRequestId') @HttpCode(200) async attachment(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Param('clientRequestId') requestId: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.attachment(r.headers.cookie, id, requestId, body));
  }
  @Get('cases/:caseId/attachment-receipts/:clientRequestId') async attachmentReceipt(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Param('clientRequestId') requestId: string,
  ) {
    return envelope(r, await this.service.attachmentReceipt(r.headers.cookie, id, requestId));
  }
  @Get('cases/:caseId/attachments/:fileId/content') async content(
    @Req() r: ApiRequest,
    @Param('caseId') id: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const file = await this.service.attachmentContent(r.headers.cookie, id, fileId);
    const extension =
      file.contentType === 'application/pdf'
        ? '.pdf'
        : file.contentType === 'image/png'
          ? '.png'
          : '.jpg';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.bytes.length));
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="evidence${extension}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/'/g, '%27')}`,
    );
    res.send(file.bytes);
  }
  @Get('reviews') async reviews(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.myReviews(r.headers.cookie, q));
  }
  @Post('reviews') @HttpCode(200) async review(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.createReview(r.headers.cookie, body));
  }
  @Post('reviews/:reviewId/commands') @HttpCode(200) async reviewCommand(
    @Req() r: ApiRequest,
    @Param('reviewId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.reviewCommand(r.headers.cookie, id, body));
  }
}
@Controller('v1/platform/governance')
export class PlatformGovernanceController {
  constructor(@Inject(SCB_GOVERNANCE_SERVICE) private readonly service: GovernanceService) {}
  @Get('cases') async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.cases(r.headers.cookie, q, true));
  }
  @Get('reviews') async reviews(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.myReviews(r.headers.cookie, q, true));
  }
}
@Controller('v1/public/governance')
export class PublicGovernanceController {
  constructor(@Inject(SCB_GOVERNANCE_SERVICE) private readonly service: GovernanceService) {}
  @Get('reviews/:publicKey') async review(@Req() r: ApiRequest, @Param('publicKey') key: string) {
    return envelope(r, await this.service.publicReview(key));
  }
}
@Controller('v1/me/city-operations')
export class CityOperationsController {
  constructor(
    @Inject(SCB_CITY_OPERATIONS_SERVICE) private readonly service: CityOperationsService,
  ) {}
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.workspace(r.headers.cookie, q));
  }
}
@Controller('v1/platform/city-operations')
export class PlatformCityOperationsController {
  constructor(
    @Inject(SCB_CITY_OPERATIONS_SERVICE) private readonly service: CityOperationsService,
  ) {}
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.workspace(r.headers.cookie, q, true));
  }
  @Post('grants') @HttpCode(200) async create(@Req() r: ApiRequest, @Body() body: unknown) {
    return envelope(r, await this.service.create(r.headers.cookie, body));
  }
  @Post('grants/:grantId/revoke') @HttpCode(200) async revoke(
    @Req() r: ApiRequest,
    @Param('grantId') id: string,
    @Body() body: unknown,
  ) {
    return envelope(r, await this.service.revoke(r.headers.cookie, id, body));
  }
}
