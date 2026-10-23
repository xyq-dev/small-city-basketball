/** Mini-program authentication only. Unconfigured providers never simulate success. */
export interface WechatCapabilitiesData {
  enabled: boolean;
  canLogin: boolean;
  canBind: boolean;
  canRegister: false;
}
export interface WechatBindingData {
  enabled: boolean;
  connected: boolean;
  version: number | null;
  linkedAt: string | null;
}
export interface WechatChallengeInput {
  purpose: 'LOGIN' | 'BIND';
  consent: true;
  /** Required for BIND; the current application session is also required. */
  password?: string;
}
export interface WechatChallengeData {
  challengeId: string;
  state: string;
  purpose: 'LOGIN' | 'BIND';
  expiresAt: string;
}
export interface WechatExchangeInput {
  challengeId: string;
  state: string;
  code: string;
  consent: true;
}
export interface WechatUnbindInput {
  password: string;
  expectedVersion: number;
  consent: true;
}
