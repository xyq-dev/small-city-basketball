import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { QUARANTINE_ADULT_DATA_CONSENTS_SQL } from './youth-adult-data-consent.js';

it('the offline restore tool appends the exact same adult withdrawal facts as the domain contract', () => {
  const source = readFileSync(
    new URL('../../../ops/recovery/quarantine.mjs', import.meta.url),
    'utf8',
  );
  const sql = /const ADULT_DATA_CONSENTS_WITHDRAW_SQL = `([\s\S]+?)`;/.exec(source)?.[1];
  expect(sql).toBe(QUARANTINE_ADULT_DATA_CONSENTS_SQL);
  expect(source).toContain('client.query(ADULT_DATA_CONSENTS_WITHDRAW_SQL, [systemUserId])');
});
