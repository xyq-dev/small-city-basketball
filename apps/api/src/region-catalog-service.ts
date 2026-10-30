import { ApplicationService } from './service.js';
import { hashToken } from './security.js';
import { parseRegionCatalogQuery } from './region-catalog-domain.js';
import { readVerifiedRegionCatalog } from './region-catalog-integrity.js';

export class RegionCatalogService extends ApplicationService {
  async publicCatalog(raw: unknown, ip: string) {
    parseRegionCatalogQuery(raw);
    await this.rateLimit(`regions-ip:${hashToken(ip)}`, 60, 60);
    return (await readVerifiedRegionCatalog(this.pool)).data;
  }
}
