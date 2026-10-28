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
import { EventFollowService } from './event-follow-service.js';
export const SCB_EVENT_FOLLOW_SERVICE = 'SCB_EVENT_FOLLOW_SERVICE';
const envelope = <T>(r: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: r.requestId, ...extra },
});

/** Own-account event follows (docs/design/C19_CONTRACTS.md §4). Never sends WeChat messages. */
@Controller('v1/me/follows')
export class EventFollowController {
  constructor(@Inject(SCB_EVENT_FOLLOW_SERVICE) readonly service: EventFollowService) {}
  @Post() async follow(
    @Req() r: ApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() raw: unknown,
  ) {
    const result = await this.service.follow(r.headers.cookie, raw);
    response.status(result.created ? 201 : 200);
    return envelope(r, result.data);
  }
  @Get() async list(@Req() r: ApiRequest, @Query() q: unknown) {
    const result = await this.service.list(r.headers.cookie, q);
    return envelope(r, result.data, { nextCursor: result.nextCursor });
  }
  @Get('lookup') async lookup(@Req() r: ApiRequest, @Query() q: unknown) {
    return envelope(r, await this.service.lookup(r.headers.cookie, q));
  }
  @Post(':followId/cancel') @HttpCode(200) async cancel(
    @Req() r: ApiRequest,
    @Param('followId') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.cancel(r.headers.cookie, id, raw));
  }
}
