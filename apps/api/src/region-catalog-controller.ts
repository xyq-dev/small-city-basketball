import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { RegionCatalogService } from './region-catalog-service.js';

export const SCB_REGION_CATALOG_SERVICE = 'SCB_REGION_CATALOG_SERVICE';

/** Public reference data; never reads cookies and never returns a Set-Cookie header. */
@Controller('v1/public/regions')
export class RegionCatalogController {
  constructor(@Inject(SCB_REGION_CATALOG_SERVICE) private readonly service: RegionCatalogService) {}
  @Get()
  async list(@Req() r: ApiRequest, @Query() query: unknown) {
    const data = await this.service.publicCatalog(
      query,
      r.ip || r.socket.remoteAddress || 'unknown',
    );
    return { data, meta: { requestId: r.requestId } };
  }
}
