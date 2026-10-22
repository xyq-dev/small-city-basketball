export const EVENT_FORMATS = Object.freeze(['ROUND_ROBIN', 'GROUP_KNOCKOUT', 'SINGLE_ELIMINATION']);
export const EVENT_STATUSES = Object.freeze([
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
]);
export const ORG_ROLES = Object.freeze([
  'ORG_OWNER',
  'ORG_ADMIN',
  'EVENT_MANAGER',
  'REVIEWER',
  'SCORER',
  'STREAMER',
]);
export const STAFF_ROLES = Object.freeze(['EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER']);

export const ENTRY_STATUSES = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'WITHDRAWN',
]);
export const ENTRY_COMMANDS = Object.freeze([
  'SUBMIT',
  'WITHDRAW',
  'APPROVE',
  'REQUEST_CHANGES',
  'REJECT',
]);
export const REGISTRATION_COMMANDS = Object.freeze([
  'OPEN_REGISTRATION',
  'CLOSE_REGISTRATION',
  'FREEZE_REGISTRATION',
]);
