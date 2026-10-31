export type NotificationKind = 'REGISTRATION_REVIEW' | 'MATCH_RESCHEDULED' | 'MATCH_STARTING';
export type NotificationDeliveryState =
  | 'WAITING_PERMISSION'
  | 'PENDING'
  | 'SENDING'
  | 'ACCEPTED'
  | 'UNKNOWN'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';
export interface NotificationCapabilities {
  wechatEnabled: boolean;
  acceptanceIsDelivery: false;
  kinds: { kind: NotificationKind; templateId: string | null }[];
}
export interface NotificationMessage {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  eventName: string;
  time: string;
  location: string | null;
  createdAt: string;
  readAt: string | null;
  delivery: NotificationDeliveryState;
  canRetry: boolean;
}
export interface NotificationIntent {
  id: string;
  kind: NotificationKind;
  templateId: string;
  expiresAt: string;
}
export interface NotificationSubscription {
  id: string;
  kind: NotificationKind;
  state: 'AVAILABLE' | 'RESERVED' | 'CONSUMED' | 'REVOKED';
  createdAt: string;
}
