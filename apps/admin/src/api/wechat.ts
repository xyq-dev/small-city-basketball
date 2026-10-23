import type {
  WechatBindingData,
  WechatCapabilitiesData,
  WechatUnbindInput,
} from '../../../../packages/contracts/wechat.js';
import { createApiClient, ApiError } from './client';
import type { ApiClient } from './client';
export interface WechatApi {
  capabilities(): Promise<WechatCapabilitiesData>;
  binding(): Promise<WechatBindingData>;
  unbind(input: WechatUnbindInput): Promise<void>;
}
export function createWechatApi(client: ApiClient = createApiClient()): WechatApi {
  return {
    async capabilities() {
      const data = (await client.request<WechatCapabilitiesData>('/v1/auth/wechat/capabilities'))
        .data;
      if (!data || typeof data.enabled !== 'boolean' || data.canRegister !== false)
        throw new ApiError(200, 'INVALID_RESPONSE', '微信能力资料无效');
      return {
        enabled: data.enabled,
        canLogin: data.canLogin === true,
        canBind: data.canBind === true,
        canRegister: false,
      };
    },
    async binding() {
      const data = (await client.request<WechatBindingData>('/v1/auth/wechat/binding')).data;
      if (
        !data ||
        typeof data.enabled !== 'boolean' ||
        typeof data.connected !== 'boolean' ||
        (data.connected && (!Number.isInteger(data.version) || !data.linkedAt))
      )
        throw new ApiError(200, 'INVALID_RESPONSE', '微信绑定资料无效');
      return {
        enabled: data.enabled,
        connected: data.connected,
        version: data.version,
        linkedAt: data.linkedAt,
      };
    },
    async unbind(input) {
      await client.request('/v1/auth/wechat/unbind', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
