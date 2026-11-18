import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../errors.js';
import { readRequiredSecret } from '../env.js';
import {
  AmapLocationProvider,
  DisabledLocationProvider,
  TencentLocationProvider,
} from '../location-provider.js';
import type { LocationProvider } from '../location-provider.js';
import { decryptLocationSecrets } from './crypto.js';

type Transport = typeof fetch;
type Row = Record<string, any>;
function envTencentKey(): string | undefined {
  if (
    process.env.SCB_TENCENT_MAP_KEY === undefined &&
    process.env.SCB_TENCENT_MAP_KEY_FILE === undefined
  )
    return undefined;
  return readRequiredSecret('SCB_TENCENT_MAP_KEY');
}
function providerFor(row: Row, transport: Transport): LocationProvider {
  const secrets = decryptLocationSecrets({
    id: row.id,
    version: row.version,
    provider: row.provider,
    signatureEnabled: row.signature_enabled,
    credentials_ciphertext: row.credentials_ciphertext,
    credentials_nonce: row.credentials_nonce,
    credentials_tag: row.credentials_tag,
  });
  if (row.provider === 'AMAP')
    return new AmapLocationProvider(
      secrets.webKey,
      row.signature_enabled ? (secrets.privateKey ?? undefined) : undefined,
      transport,
    );
  return new TencentLocationProvider(secrets.webKey, transport);
}

/** One database read selects exactly one provider for the call. Vendors are never merged. */
export async function resolveLocationProvider(
  client: Pool | PoolClient,
  transport: Transport = fetch,
): Promise<LocationProvider> {
  let state: Row | undefined;
  try {
    state = (await client.query('SELECT * FROM location_config_state WHERE singleton=true'))
      .rows[0];
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01') return new TencentLocationProvider(envTencentKey(), transport);
    throw new ApiError(503, 'LOCATION_PROVIDER_UNAVAILABLE', '地图配置暂不可读，请手动选城');
  }
  if (!state || state.external_mode === 'UNCONFIGURED')
    return new TencentLocationProvider(envTencentKey(), transport);
  if (state.external_mode === 'DISABLED' || !state.active_revision_id)
    return new DisabledLocationProvider();
  const revision = (
    await client.query('SELECT * FROM location_config_revisions WHERE id=$1', [
      state.active_revision_id,
    ])
  ).rows[0];
  if (!revision)
    throw new ApiError(503, 'LOCATION_PROVIDER_UNAVAILABLE', '已启用的地图配置不存在，请手动选城');
  return providerFor(revision, transport);
}

export class RoutingLocationProvider implements LocationProvider {
  private enabledFlag = false;
  constructor(
    private readonly pool: Pool,
    private readonly transport: Transport = fetch,
  ) {}
  get enabled() {
    return this.enabledFlag;
  }
  async prepare() {
    const provider = await resolveLocationProvider(this.pool, this.transport);
    this.enabledFlag = provider.enabled;
  }
  private async current() {
    const provider = await resolveLocationProvider(this.pool, this.transport);
    this.enabledFlag = provider.enabled;
    return provider;
  }
  async reverse(point: Parameters<LocationProvider['reverse']>[0]) {
    return (await this.current()).reverse(point);
  }
  async search(
    keyword: string,
    sourceCode: string,
    point?: Parameters<LocationProvider['search']>[2],
  ) {
    return (await this.current()).search(keyword, sourceCode, point);
  }
}
