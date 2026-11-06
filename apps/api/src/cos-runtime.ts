import { readRequiredSecret } from './env.js';
import { TencentCosObjectStore } from './cos-storage.js';
import type { CosObjectStore } from './cos-storage.js';

/** Loading configuration creates no resources and makes no network request. */
export function readCosObjectStore(): CosObjectStore | undefined {
  const mode = process.env.SCB_MEDIA_STORAGE ?? 'DATABASE';
  if (mode === 'DATABASE') return undefined;
  if (mode !== 'COS') throw new Error('Invalid media storage configuration');
  try {
    const hasToken =
      process.env.SCB_COS_SESSION_TOKEN !== undefined ||
      process.env.SCB_COS_SESSION_TOKEN_FILE !== undefined;
    return new TencentCosObjectStore({
      bucket: process.env.SCB_COS_BUCKET ?? '',
      region: process.env.SCB_COS_REGION ?? '',
      prefix: process.env.SCB_COS_PREFIX ?? 'scb-media/v1',
      secretId: readRequiredSecret('SCB_COS_SECRET_ID'),
      secretKey: readRequiredSecret('SCB_COS_SECRET_KEY'),
      ...(hasToken ? { sessionToken: readRequiredSecret('SCB_COS_SESSION_TOKEN') } : {}),
    });
  } catch {
    // Fail closed, with no path, key, SDK headers, or configuration contents in the error.
    throw new Error('COS configuration is unavailable or invalid');
  }
}
