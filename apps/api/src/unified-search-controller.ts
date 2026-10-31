import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { UnifiedSearchService } from './unified-search-service.js';
export const SCB_UNIFIED_SEARCH = 'SCB_UNIFIED_SEARCH';
@Controller('v1/public/search')
export class UnifiedSearchController {
  constructor(@Inject(SCB_UNIFIED_SEARCH) private readonly service: UnifiedSearchService) {}
  @Get() async search(@Req() r: ApiRequest, @Query() q: unknown) {
    return {
      data: await this.service.search(q, r.ip || r.socket.remoteAddress || 'unknown'),
      meta: { requestId: r.requestId },
    };
  }
}
