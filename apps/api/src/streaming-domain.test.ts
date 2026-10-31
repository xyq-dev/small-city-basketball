import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  allowedObservation,
  channelEndpoint,
  endpoint,
  highlightIntervals,
  openStreamSecret,
  parseStreamingCommand,
  publicAddress,
  scoreText,
  sealStreamSecret,
  streamKey,
} from './streaming-domain.js';
import { cssHeaders, TencentCssIngress, resolvePublic } from './streaming-provider.js';
const key = Buffer.alloc(32, 7);
describe('E01/E02 authorization, transport and event-time boundaries', () => {
  it('keeps channel keys under the operator-approved application path after URL normalization', () => {
    expect(
      channelEndpoint('relay.example.com', 'live', 'synthetic-key?token=synthetic').pathname,
    ).toBe('/live/synthetic-key');
    for (const key of ['../foreign', '%2e%2e/foreign', '../../other'])
      expect(() => channelEndpoint('relay.example.com', 'live', key)).toThrow();
  });
  it('AEAD binds the ciphertext to the exact channel identity and key', () => {
    const cipher = sealStreamSecret(key, 'one', 'private-publish-key');
    expect(openStreamSecret(key, 'one', cipher)).toBe('private-publish-key');
    expect(() => openStreamSecret(key, 'two', cipher)).toThrow();
    expect(() => openStreamSecret(Buffer.alloc(32, 8), 'one', cipher)).toThrow();
    expect(() => streamKey('bad')).toThrow();
    expect(streamKey(key.toString('base64'))).toEqual(key);
  });
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '100.64.2.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
  ])('refuses non-public and ambiguous addresses %s', (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it('validates all answers, not only the first DNS answer', async () => {
    const resolver = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    await expect(resolvePublic('verified.example', resolver as any)).rejects.toThrow(
      'STREAM_ENDPOINT_UNSAFE',
    );
  });
  it('rejects unapproved hosts, credentials, ports and URL schemes', () => {
    for (const u of [
      'https://bad.example/live',
      'https://user:key@ok.example/live',
      'https://ok.example:8080/live',
      'http://ok.example/live',
      'https://ok.example/live#key',
    ])
      expect(() => endpoint(u, 'https:', ['ok.example'])).toThrow();
    expect(
      endpoint('https://ok.example/live?token=secret', 'https:', ['ok.example']).hostname,
    ).toBe('ok.example');
  });
  it('does not turn a stale START or connected result into current live state', () => {
    expect(allowedObservation('STOPPED', 2, 1, 'CONNECTED')).toBe(false);
    expect(allowedObservation('PAUSED', 2, 2, 'CONNECTED')).toBe(false);
    expect(allowedObservation('RUNNING', 2, 2, 'CONNECTED')).toBe(true);
    expect(allowedObservation('STOPPED', 2, 2, 'STOPPED')).toBe(true);
  });
  it('ticks the authoritative clock once and escapes only display content', () => {
    expect(
      scoreText(
        '甲\n队',
        '乙',
        {
          source_version: 1,
          home_score: 3,
          away_score: 2,
          period: 1,
          remaining_ms: 120000,
          clock_running: true,
          anchor_server_time: '2026-01-01T00:00:00Z',
          clock_version: 2,
        },
        Date.parse('2026-01-01T00:00:05Z'),
      ),
    ).toContain('1:55');
    expect(scoreText('甲', '乙', null, 0)).toBe('比分更新中');
  });
  it('requires current command identity, valid targets and explicit bounded budget', () => {
    const b = {
      clientRequestId: randomUUID(),
      type: 'CREATE',
      channelIds: [randomUUID()],
      maximumSeconds: 60,
      budgetFen: 10,
      record: false,
    };
    expect(parseStreamingCommand(b).maximumSeconds).toBe(60);
    expect(() => parseStreamingCommand({ ...b, budgetFen: 0 })).toThrow();
    expect(() =>
      parseStreamingCommand({ ...b, channelIds: [b.channelIds[0], b.channelIds[0]] }),
    ).toThrow();
    expect(() =>
      parseStreamingCommand({
        clientRequestId: randomUUID(),
        type: 'STOP',
        sessionId: randomUUID(),
        expectedVersion: 1,
        reason: 'x',
      }),
    ).toThrow();
  });
  it('requires an explicit operation basis for each approval and source stop barrier', () => {
    for (const type of ['APPROVE', 'PAUSE', 'STOP', 'REVOKE']) {
      const command = {
        clientRequestId: randomUUID(),
        sessionId: randomUUID(),
        expectedVersion: 1,
        type,
      };
      expect(() => parseStreamingCommand(command)).toThrow('请填写操作依据');
      expect(() => parseStreamingCommand({ ...command, reason: '简短' })).toThrow('请填写操作依据');
      expect(
        parseStreamingCommand({ ...command, reason: '主办方已核对本场直播与录像用途' }).reason,
      ).toBe('主办方已核对本场直播与录像用途');
    }
  });
  it('ignores offline-captured and voided events and merges only calibrated real windows', () => {
    const anchor = '2026-01-01T00:00:00Z';
    expect(
      highlightIntervals(
        [
          {
            capturedAt: '2026-01-01T00:00:10Z',
            serverTime: '2026-01-01T00:00:10Z',
            effective: true,
          },
          {
            capturedAt: '2026-01-01T00:00:12Z',
            serverTime: '2026-01-01T00:00:12Z',
            effective: true,
          },
          {
            capturedAt: '2026-01-01T00:00:20Z',
            serverTime: '2026-01-01T00:01:00Z',
            effective: true,
          },
          {
            capturedAt: '2026-01-01T00:00:25Z',
            serverTime: '2026-01-01T00:00:25Z',
            effective: false,
          },
        ],
        anchor,
        0,
        60000,
      ),
    ).toEqual([{ startMs: 7000, endMs: 17000 }]);
    expect(() => highlightIntervals([], 'bad', 0, 1)).toThrow();
  });
  it('uses official CSS signing and only a queried forbid result confirms revocation', async () => {
    const o = {
      pushHost: 'push.example.test',
      playbackHost: 'play.example.test',
      appName: 'live',
      pushKey: '0123456789abcdef',
      playbackKey: 'abcdef0123456789',
      secretId: 'AKID0123456789abcdef',
      secretKey: '0123456789abcdef0123456789abcdef',
      pushProtocol: 'rtmp:' as const,
    };
    const calls: string[] = [];
    const css = new TencentCssIngress(o, async (r) => {
      calls.push(r.action);
      return { RequestId: 'synthetic', StreamState: 'active' };
    });
    const name = 'scb-' + randomUUID() + '-1';
    expect(css.lease(name, new Date('2026-01-01T00:00:30Z')).pushUrl).toMatch(
      /^rtmp:\/\/push\.example\.test\/live\/scb-.*txSecret=[a-f0-9]{32}&txTime=[A-F0-9]+$/,
    );
    expect(await css.revoke(name)).toBe(false);
    expect(calls).toEqual(['ForbidLiveStream', 'DescribeLiveStreamState']);
    const stop = new TencentCssIngress(o, async () => ({
      RequestId: 'synthetic',
      StreamState: 'forbid',
    }));
    expect(await stop.revoke(name)).toBe(true);
    const headers = cssHeaders('ForbidLiveStream', '{}', o, new Date('2026-01-01T00:00:00Z'));
    expect(headers.Authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKID.*\/2026-01-01\/live\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/,
    );
  });
});
