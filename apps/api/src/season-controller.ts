import { Controller, Inject } from '@nestjs/common';
import { SeasonService } from './season-service.js';
export const SCB_SEASON_SERVICE = 'SCB_SEASON_SERVICE';

/** C19 skeleton; routes are frozen in docs/design/C19_CONTRACTS.md. */
@Controller()
export class SeasonController {
  constructor(@Inject(SCB_SEASON_SERVICE) readonly service: SeasonService) {}
}
