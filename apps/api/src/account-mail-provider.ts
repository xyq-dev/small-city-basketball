import { emailInput } from './validation.js';

export interface AccountMail {
  to: string;
  subject: string;
  text: string;
}
export interface AccountMailResult {
  state: 'ACCEPTED' | 'UNKNOWN' | 'FAILED';
  providerId?: string;
}
export interface AccountMailProvider {
  send(id: string, mail: AccountMail): Promise<AccountMailResult>;
}

/** Fixed official HTTPS destination. No user-selected mail URL, redirect or HTML. */
export class ResendAccountMailProvider implements AccountMailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    emailInput(from);
    if (!apiKey || apiKey.length > 512 || /[\u0000-\u0020\u007f]/.test(apiKey))
      throw new Error('Mail provider configuration is invalid');
  }
  async send(id: string, mail: AccountMail): Promise<AccountMailResult> {
    emailInput(mail.to);
    if (
      !/^[0-9a-f-]{36}$/.test(id) ||
      mail.subject.length > 120 ||
      /[\r\n]/.test(mail.subject) ||
      mail.text.length > 8000
    )
      throw new Error('Invalid account mail');
    try {
      const response = await this.transport('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `scb-account-${id}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
      });
      if (!response.body) return { state: 'UNKNOWN' };
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 32768) {
          await reader.cancel();
          return { state: 'UNKNOWN' };
        }
        chunks.push(part.value);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: unknown };
      if (response.ok && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.id))
        return { state: 'ACCEPTED', providerId: value.id };
      return {
        state:
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 409, 429].includes(response.status)
            ? 'FAILED'
            : 'UNKNOWN',
      };
    } catch {
      return { state: 'UNKNOWN' };
    }
  }
}
