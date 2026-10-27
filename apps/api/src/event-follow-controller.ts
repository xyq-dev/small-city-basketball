import { Controller, Inject } from '@nestjs/common';
import { EventFollowService } from './event-follow-service.js';
export const SCB_EVENT_FOLLOW_SERVICE = 'SCB_EVENT_FOLLOW_SERVICE';

/** C19 skeleton; routes are frozen in docs/design/C19_CONTRACTS.md. */
@Controller()
export class EventFollowController {
  constructor(@Inject(SCB_EVENT_FOLLOW_SERVICE) readonly service: EventFollowService) {}
}
