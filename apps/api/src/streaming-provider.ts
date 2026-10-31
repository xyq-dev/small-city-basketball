import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { publicAddress, endpoint } from './streaming-domain.js';
export interface PublicPin {
  address: string;
  family: 4 | 6;
}
export async function resolvePublic(host: string, resolver = lookup): Promise<PublicPin> {
  const found = await resolver(host, { all: true, verbatim: true });
  if (!found.length || found.some((r) => !publicAddress(r.address)))
    throw Error('STREAM_ENDPOINT_UNSAFE');
  return { address: found[0]!.address, family: found[0]!.family as 4 | 6 };
}
/** TLS always authenticates the configured hostname while TCP uses the checked fixed address. No redirects. */
export async function secureInput(url: URL): Promise<IncomingMessage> {
  const pin = await resolvePublic(url.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        servername: url.hostname,
        lookup: (_h, _o, cb) => cb(null, pin.address, pin.family),
        rejectUnauthorized: true,
        timeout: 10000,
      },
      (r) => {
        if (r.statusCode !== 200) {
          r.destroy();
          reject(Error('STREAM_INPUT_UNAVAILABLE'));
          return;
        }
        resolve(r);
      },
    );
    req.on('timeout', () => req.destroy(Error('STREAM_INPUT_TIMEOUT')));
    req.on('error', () => reject(Error('STREAM_INPUT_UNAVAILABLE')));
    req.end();
  });
}
export interface RtmpTransport {
  localUrl: string;
  tcUrl: string;
  close(): Promise<void>;
}
/** FFmpeg only connects to this owned loopback socket. This proxy owns DNS and TLS. */
export async function pinnedRtmp(url: URL): Promise<RtmpTransport> {
  const pin = await resolvePublic(url.hostname),
    peers = new Set<Socket>();
  let used = false;
  const server: Server = createServer((local) => {
    if (used) {
      local.destroy();
      return;
    }
    used = true;
    peers.add(local);
    server.close();
    const remote = tlsConnect({
      host: pin.address,
      port: 443,
      servername: url.hostname,
      rejectUnauthorized: true,
      timeout: 10000,
    });
    peers.add(remote);
    const close = () => {
      local.destroy();
      remote.destroy();
      peers.delete(local);
      peers.delete(remote);
    };
    local.on('error', close);
    remote.on('error', close);
    remote.on('timeout', close);
    remote.on('secureConnect', () => {
      local.pipe(remote);
      remote.pipe(local);
    });
    local.on('close', close);
    remote.on('close', close);
  });
  await new Promise<void>((res, rej) => {
    server.once('error', () => rej(Error('STREAM_TRANSPORT_FAILED')));
    server.listen(0, '127.0.0.1', res);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('STREAM_TRANSPORT_FAILED');
  const slash = url.pathname.lastIndexOf('/');
  return {
    localUrl: `rtmp://127.0.0.1:${address.port}${url.pathname}${url.search}`,
    tcUrl: `rtmps://${url.host}${url.pathname.slice(0, slash)}`,
    close: async () => {
      for (const p of peers) p.destroy();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
export interface IngressLease {
  pushUrl: string;
  pullUrl: string;
  expiresAt: string;
}
export interface IngressProvider {
  readonly enabled: boolean;
  lease(streamName: string, expiresAt: Date): IngressLease;
  revoke(streamName: string): Promise<boolean>;
}
export interface TencentIngressOptions {
  pushHost: string;
  playbackHost: string;
  appName: string;
  pushKey: string;
  playbackKey: string;
  secretId: string;
  secretKey: string;
  pushProtocol: 'rtmp:' | 'rtmps:';
}
export type CssTransport = (request: {
  action: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<Record<string, any>>;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: string | Buffer, s: string) => createHmac('sha256', k).update(s).digest();
export function cssHeaders(
  action: string,
  body: string,
  options: Pick<TencentIngressOptions, 'secretId' | 'secretKey'>,
  at = new Date(),
) {
  const timestamp = Math.floor(at.getTime() / 1000),
    date = at.toISOString().slice(0, 10),
    host = 'live.tencentcloudapi.com',
    scope = `${date}/live/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${sha(body)}`;
  const key = hmac(hmac(hmac('TC3' + options.secretKey, date), 'live'), 'tc3_request');
  const signature = createHmac('sha256', key)
    .update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`)
    .digest('hex');
  return {
    'Content-Type': 'application/json; charset=utf-8',
    Host: host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2018-08-01',
    Authorization: `TC3-HMAC-SHA256 Credential=${options.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
  };
}
async function cssHttp(r: Parameters<CssTransport>[0]): Promise<Record<string, any>> {
  const host = 'live.tencentcloudapi.com',
    pin = await resolvePublic(host);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: host,
        port: 443,
        path: '/',
        method: 'POST',
        headers: r.headers,
        servername: host,
        lookup: (_h, _o, cb) => cb(null, pin.address, pin.family),
        rejectUnauthorized: true,
        timeout: 7000,
      },
      (response) => {
        let size = 0;
        const parts: Buffer[] = [];
        response.on('data', (b: Buffer) => {
          size += b.length;
          if (size > 65536) response.destroy(Error('CSS_RESPONSE_INVALID'));
          else parts.push(b);
        });
        response.on('error', () => reject(Error('CSS_RESULT_UNKNOWN')));
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw Error();
            const v = JSON.parse(Buffer.concat(parts).toString('utf8'));
            if (!v.Response || v.Response.Error || typeof v.Response.RequestId !== 'string')
              throw Error();
            resolve(v.Response);
          } catch {
            reject(Error('CSS_RESULT_UNKNOWN'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(Error('CSS_RESULT_UNKNOWN')));
    req.on('error', () => reject(Error('CSS_RESULT_UNKNOWN')));
    req.end(r.body);
  });
}
/** Official CSS short-lived signing plus actual forbid/query. An accepted forbid is not stopped evidence. */
export class TencentCssIngress implements IngressProvider {
  readonly enabled = true;
  constructor(
    private readonly options: TencentIngressOptions,
    private readonly transport: CssTransport = cssHttp,
  ) {
    for (const h of [options.pushHost, options.playbackHost])
      endpoint('https://' + h + '/', 'https:', [h]);
    if (
      !/^[A-Za-z0-9_-]{1,32}$/.test(options.appName) ||
      ![options.pushKey, options.playbackKey, options.secretId, options.secretKey].every(
        (v) => typeof v === 'string' && v.length >= 16 && v.length <= 256,
      ) ||
      !['rtmp:', 'rtmps:'].includes(options.pushProtocol)
    )
      throw Error('Invalid streaming ingress configuration');
  }
  lease(name: string, until: Date): IngressLease {
    if (!/^scb-[a-f0-9-]{36}-[0-9]+$/.test(name) || !Number.isFinite(until.getTime()))
      throw Error('Invalid stream identity');
    const expiry = Math.floor(until.getTime() / 1000)
      .toString(16)
      .toUpperCase();
    const signed = (key: string) =>
      `txSecret=${createHash('md5')
        .update(key + name + expiry)
        .digest('hex')}&txTime=${expiry}`;
    return {
      pushUrl: `${this.options.pushProtocol}//${this.options.pushHost}/${this.options.appName}/${name}?${signed(this.options.pushKey)}`,
      pullUrl: `https://${this.options.playbackHost}/${this.options.appName}/${name}.flv?${signed(this.options.playbackKey)}`,
      expiresAt: until.toISOString(),
    };
  }
  async revoke(name: string): Promise<boolean> {
    if (!/^scb-[a-f0-9-]{36}-[0-9]+$/.test(name)) throw Error('Invalid stream identity');
    const payload = {
      DomainName: this.options.pushHost,
      AppName: this.options.appName,
      StreamName: name,
    };
    try {
      const body = JSON.stringify({ ...payload, Reason: 'SCB explicit source epoch revocation' });
      await this.transport({
        action: 'ForbidLiveStream',
        body,
        headers: cssHeaders('ForbidLiveStream', body, this.options),
      });
      const query = JSON.stringify(payload),
        result = await this.transport({
          action: 'DescribeLiveStreamState',
          body: query,
          headers: cssHeaders('DescribeLiveStreamState', query, this.options),
        });
      return result.StreamState === 'forbid';
    } catch {
      return false;
    }
  }
}
