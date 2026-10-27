import { Controller, Inject } from '@nestjs/common';
import { TeamMembershipService } from './team-membership-service.js';
export const SCB_TEAM_MEMBERSHIP_SERVICE = 'SCB_TEAM_MEMBERSHIP_SERVICE';

/** C19 skeleton; routes are frozen in docs/design/C19_CONTRACTS.md. */
@Controller()
export class TeamMembershipController {
  constructor(@Inject(SCB_TEAM_MEMBERSHIP_SERVICE) readonly service: TeamMembershipService) {}
}
