import type { AuthCapabilitiesData } from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capabilities(value: unknown): AuthCapabilitiesData {
  if (
    !object(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'canRegisterOrganization') ||
    !Object.hasOwn(value, 'canRegisterParticipant') ||
    typeof value.canRegisterOrganization !== 'boolean' ||
    typeof value.canRegisterParticipant !== 'boolean'
  )
    throw new ApiError(200, 'INVALID_AUTH_CAPABILITIES', '服务返回的注册设置不完整，请重新读取');
  return {
    canRegisterOrganization: value.canRegisterOrganization,
    canRegisterParticipant: value.canRegisterParticipant,
  };
}

/** Public service configuration; a failed read never implies registration is open. */
export function createAuthCapabilitiesApi(client: ApiClient) {
  return {
    async read(signal?: AbortSignal): Promise<AuthCapabilitiesData> {
      if (signal?.aborted) throw new ApiError(0, 'AUTH_CAPABILITIES_ABORTED', '已取消读取注册设置');
      const controller = new AbortController();
      let cancel: (reason: ApiError) => void = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => {
        cancel = reject;
      });
      const abort = () => {
        controller.abort();
        cancel(new ApiError(0, 'AUTH_CAPABILITIES_ABORTED', '已取消读取注册设置'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        controller.abort();
        cancel(new ApiError(0, 'AUTH_CAPABILITIES_TIMEOUT', '读取注册设置超时，请重试'));
      }, 8000);
      try {
        const response = await Promise.race([
          client.request<unknown>('/v1/auth/capabilities', {
            method: 'GET',
            signal: controller.signal,
          }),
          interrupted,
        ]);
        return capabilities(response.data);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export type AuthCapabilitiesApi = ReturnType<typeof createAuthCapabilitiesApi>;
