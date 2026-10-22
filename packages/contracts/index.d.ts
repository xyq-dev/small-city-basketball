export const EVENT_FORMATS: readonly ['ROUND_ROBIN', 'GROUP_KNOCKOUT', 'SINGLE_ELIMINATION'];
export type EventFormat = (typeof EVENT_FORMATS)[number];
export const EVENT_STATUSES: readonly [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const ORG_ROLES: readonly [
  'ORG_OWNER',
  'ORG_ADMIN',
  'EVENT_MANAGER',
  'REVIEWER',
  'SCORER',
  'STREAMER',
];
export type OrgRole = (typeof ORG_ROLES)[number];
export const STAFF_ROLES: readonly ['EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER'];
export type StaffRole = (typeof STAFF_ROLES)[number];
export interface CreateEventInput {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName?: string;
  format: EventFormat;
}
export interface EventData {
  permissions?: { canEditDraft: boolean };
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
  format: EventFormat;
  status: EventStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrgRole;
}
export interface SessionData {
  user: { id: string; email: string; displayName: string };
  organizations: OrganizationSummary[];
}
export interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string; nextCursor?: string | null };
}
