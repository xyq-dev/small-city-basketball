import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import COS from 'cos-nodejs-sdk-v5';
import { ApiError } from './errors.js';
import { MAX_MEDIA_FILE_BYTES } from './media-domain.js';

export interface CosObjectLocation {
  bucket: string;
  region: string;
  key: string;
}
export interface CosObjectStore {
  readonly bucket: string;
  readonly region: string;
  readonly prefix: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(location: CosObjectLocation): Promise<Buffer>;
  delete(location: CosObjectLocation): Promise<void>;
}
export interface TencentCosOptions {
  bucket: string;
  region: string;
  prefix: string;
  secretId: string;
  secretKey: string;
  sessionToken?: string;
}
type CosClient = Pick<COS, 'putObject' | 'getObject' | 'deleteObject' | 'getBucketVersioning'>;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const suffix = new RegExp(`^${UUID}/${UUID}/${UUID}$`);
const unavailable = () =>
  new ApiError(503, 'MEDIA_STORAGE_UNAVAILABLE', '媒体云存储暂不可用，请稍后重试');
const secret = (value: string) =>
  typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/\s/.test(value);

/** No custom domains, URLs or client-provided object paths are accepted. */
export function validCosDestination(bucket: string, region: string, prefix: string): boolean {
  return (
    typeof bucket === 'string' &&
    bucket.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?-[1-9][0-9]{4,19}$/.test(bucket) &&
    typeof region === 'string' &&
    region.length <= 40 &&
    /^[a-z]{2}-[a-z]+(?:-[a-z0-9]+)*$/.test(region) &&
    typeof prefix === 'string' &&
    prefix.length > 0 &&
    prefix.length <= 128 &&
    prefix.split('/').every((part) => part.length <= 63 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part))
  );
}

/**
 * Private, bounded server-side COS storage. Existing API permissions remain authoritative:
 * this adapter never returns a public URL, signed URL, or cloud credential to a consumer.
 */
export class TencentCosObjectStore implements CosObjectStore {
  readonly bucket: string;
  readonly region: string;
  readonly prefix: string;
  private readonly client: CosClient;

  constructor(options: TencentCosOptions, client?: CosClient) {
    if (
      !validCosDestination(options.bucket, options.region, options.prefix) ||
      !secret(options.secretId) ||
      !secret(options.secretKey) ||
      (options.sessionToken !== undefined && !secret(options.sessionToken))
    )
      throw new Error('Invalid COS configuration');
    this.bucket = options.bucket;
    this.region = options.region;
    this.prefix = options.prefix;
    this.client =
      client ??
      new COS({
        SecretId: options.secretId,
        SecretKey: options.secretKey,
        ...(options.sessionToken ? { SecurityToken: options.sessionToken } : {}),
        Domain: '{Bucket}.cos.{Region}.myqcloud.com',
        Protocol: 'https:',
        StrictSsl: true,
        ForceSignHost: true,
        FollowRedirect: false,
        AutoSwitchHost: false,
        Timeout: 30000,
        ChunkRetryTimes: 0,
        UploadCheckContentMd5: true,
        KeepAlive: true,
      });
  }

  private params(location: CosObjectLocation) {
    if (
      location.bucket !== this.bucket ||
      location.region !== this.region ||
      !location.key.startsWith(this.prefix + '/') ||
      !suffix.test(location.key.slice(this.prefix.length + 1))
    )
      throw unavailable();
    return { Bucket: this.bucket, Region: this.region, Key: location.key };
  }

  private async requireUnversionedBucket() {
    // A versioned or suspended bucket does not honor forbid-overwrite, and a plain delete
    // creates a deletion marker rather than removing billable bytes. Recheck before every
    // mutating request; no network request is made during application initialization.
    const result = await this.client.getBucketVersioning({
      Bucket: this.bucket,
      Region: this.region,
    });
    const configuration = result.VersioningConfiguration;
    if (
      !configuration ||
      typeof configuration !== 'object' ||
      Array.isArray(configuration) ||
      configuration.Status !== undefined
    )
      throw unavailable();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      const params = this.params({ bucket: this.bucket, region: this.region, key });
      if (
        !Buffer.isBuffer(body) ||
        body.length < 1 ||
        body.length > MAX_MEDIA_FILE_BYTES ||
        !['application/pdf', 'image/png', 'image/jpeg', 'video/mp4'].includes(contentType)
      )
        throw unavailable();
      await this.requireUnversionedBucket();
      await this.client.putObject({
        ...params,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
        ACL: 'private',
        CacheControl: 'private, no-store',
        ServerSideEncryption: 'AES256',
        Headers: {
          'Content-MD5': createHash('md5').update(body).digest('base64'),
          'x-cos-forbid-overwrite': 'true',
        },
      });
    } catch {
      // SDK errors contain signed URLs and request headers; deliberately omit causes/details.
      throw unavailable();
    }
  }

  async get(location: CosObjectLocation): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let length = 0;
    // SDK's default buffered get trusts the remote object size. Use its Output stream and
    // count actual received bytes, even if Content-Length is absent or deliberately false.
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (!Buffer.isBuffer(chunk) || length + chunk.length > MAX_MEDIA_FILE_BYTES) {
          callback(unavailable());
          return;
        }
        length += chunk.length;
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const deadline = setTimeout(() => output.destroy(unavailable()), 30000);
    deadline.unref();
    try {
      const params = this.params(location);
      await new Promise<void>((resolve, reject) => {
        output.on('error', reject);
        this.client.getObject({ ...params, Output: output }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      if (!length) throw unavailable();
      return Buffer.concat(chunks, length);
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(deadline);
      // Keep the error listener attached: SDK can emit an error and invoke its callback.
      output.destroy();
    }
  }

  async delete(location: CosObjectLocation): Promise<void> {
    try {
      const params = this.params(location);
      await this.requireUnversionedBucket();
      const result = await this.client.deleteObject(params);
      // SDK v3 converts every HTTP 404 into a resolved BucketNotFound result. A missing
      // bucket is a configuration problem, so it must not acknowledge a purge as complete.
      if ('BucketNotFound' in result && result.BucketNotFound) throw unavailable();
    } catch (error) {
      // COS deletion is idempotent; an already absent object also completes cleanup.
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        error.statusCode === 404 &&
        'code' in error &&
        error.code === 'NoSuchKey'
      )
        return;
      throw unavailable();
    }
  }
}
