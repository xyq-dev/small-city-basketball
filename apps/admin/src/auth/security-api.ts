import type { ApiClient } from '../api/client';

export interface InitializeOwnerInput {
  token: string;
  email: string;
  displayName: string;
  organizationName: string;
  password: string;
  confirmPassword: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function createAccountSecurityApi(client: ApiClient) {
  return {
    async initialize(input: InitializeOwnerInput): Promise<void> {
      await client.request('/v1/setup/initialize', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async changePassword(input: ChangePasswordInput): Promise<void> {
      await client.request('/v1/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
