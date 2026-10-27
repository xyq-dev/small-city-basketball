import { Controller, Inject } from '@nestjs/common';
import { MediaRequestService } from './media-request-service.js';
export const SCB_MEDIA_REQUEST_SERVICE = 'SCB_MEDIA_REQUEST_SERVICE';

/** C19 skeleton; routes are frozen in docs/design/C19_CONTRACTS.md. */
@Controller()
export class MediaRequestController {
  constructor(@Inject(SCB_MEDIA_REQUEST_SERVICE) readonly service: MediaRequestService) {}
}
