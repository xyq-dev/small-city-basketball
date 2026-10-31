import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  accountTokenHash,
  deliveryKey,
  openMail,
  parseRecoveryConsume,
  parseRecoveryRequest,
  recoveryFingerprint,
  sealMail,
} from './account-recovery-domain.js';
import { ResendAccountMailProvider } from './account-mail-provider.js';

describe('account recovery privacy and provider boundary', () => {
  test('strict canonical token, uuid and password inputs', () => {
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    expect(parseRecoveryRequest({ clientRequestId: id, email: 'PLAYER@example.test' }).email).toBe(
      'player@example.test',
    );
    expect(
      parseRecoveryConsume({ clientRequestId: id, token, newPassword: 'synthetic-password-123' })
        .token,
    ).toBe(token);
    expect(() =>
      parseRecoveryConsume({ clientRequestId: id, token: token + '=', newPassword: 'short' }),
    ).toThrow();
    expect(() =>
      parseRecoveryRequest({ clientRequestId: id, email: 'a@example.test', extra: true }),
    ).toThrow();
  });
  test('mail ciphertext binds the job and dedicated key; fingerprint is keyed', () => {
    const key = randomBytes(32),
      id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    expect(deliveryKey(key.toString('base64'))).toEqual(key);
    const cipher = sealMail(key, id, { token });
    expect(cipher.includes(Buffer.from(token))).toBe(false);
    expect(openMail(key, id, cipher)).toEqual({ token });
    expect(() => openMail(key, randomUUID(), cipher)).toThrow();
    expect(() => openMail(randomBytes(32), id, cipher)).toThrow();
    expect(recoveryFingerprint(key, { token })).not.toBe(
      recoveryFingerprint(randomBytes(32), { token }),
    );
    expect(accountTokenHash(token)).toHaveLength(64);
  });
  test('fixed HTTPS endpoint and stable idempotency; provider acceptance is not delivery', async () => {
    const calls: { url: string; opts: RequestInit }[] = [];
    const transport = (async (url: string | URL | Request, opts: RequestInit) => {
      calls.push({ url: String(url), opts });
      return new Response(JSON.stringify({ id: 'synthetic_provider_id' }), { status: 200 });
    }) as typeof fetch;
    const p = new ResendAccountMailProvider(
        'synthetic-not-a-real-key',
        'sender@example.test',
        transport,
      ),
      id = randomUUID();
    const result = await p.send(id, {
      to: 'player@example.test',
      subject: '账号操作',
      text: 'synthetic-code',
    });
    expect(result).toEqual({ state: 'ACCEPTED', providerId: 'synthetic_provider_id' });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.opts.redirect).toBe('error');
    expect((calls[0]!.opts.headers as Record<string, string>)['Idempotency-Key']).toBe(
      `scb-account-${id}`,
    );
  });
  test('timeouts, oversized and ambiguous responses stay UNKNOWN', async () => {
    for (const response of [
      () => {
        throw new Error('synthetic timeout');
      },
      () => new Response('x'.repeat(40000)),
      () => new Response('{}', { status: 429 }),
    ]) {
      const p = new ResendAccountMailProvider('synthetic-key', 'sender@example.test', (async () =>
        response()) as typeof fetch);
      expect(
        (await p.send(randomUUID(), { to: 'a@example.test', subject: 'test', text: 'code' })).state,
      ).toBe('UNKNOWN');
    }
  });
});
