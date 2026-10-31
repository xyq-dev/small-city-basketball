import { describe, expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { exactTableRows } from '../../../ops/recovery/fingerprint-rows.mjs';
import { functionSql, loadManifest } from '../../../ops/db/privileges.mjs';
describe('private recovery fingerprint boundaries', () => {
  test.each([
    ['governance_case_attachments', 'content'],
    ['account_mail_jobs', 'envelope'],
    ['participant_material_revisions', 'payload_ciphertext'],
    ['media_files', 'payload'],
  ])('hashes %s bytes in PostgreSQL before crossing into Node', async (table, payload) => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: ['id', 'status', payload].map((attname) => ({ attname })) })
      .mockResolvedValueOnce({ rows: [{ value: '{"hash":"synthetic"}' }] });
    expect(await exactTableRows({ query } as unknown as PoolClient, table)).toEqual([
      { value: '{"hash":"synthetic"}' },
    ]);
    const sql = query.mock.calls[1]![0] as string;
    expect(sql).toContain('sha256(');
    expect(sql).toContain('octet_length(');
    expect(sql).not.toContain('SELECT "id","status","' + payload + '"');
    expect(sql).toContain(
      payload === 'payload_ciphertext' ? `convert_to("${payload}",'UTF8')` : `sha256("${payload}")`,
    );
  });
  test('rejects ambiguous payload metadata rather than exposing raw private bytes', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({
        rows: [{ attname: 'id' }, { attname: 'envelope' }, { attname: 'stored_envelope_sha256' }],
      });
    await expect(
      exactTableRows({ query } as unknown as PoolClient, 'account_mail_jobs'),
    ).rejects.toThrow('Unexpected media fingerprint schema');
    expect(query).toHaveBeenCalledTimes(1);
  });
  test('function signatures contain only checked identifiers/types and the reviewed manifest contains all new domains', async () => {
    expect(functionSql('x12_calendar_lock()')).toBe('public."x12_calendar_lock"()');
    for (const value of [
      'x();DELETE FROM users',
      'public.x()',
      'x(text DEFAULT 1)',
      'x(uuid) SECURITY DEFINER',
      'x(unknown)',
    ])
      expect(() => functionSql(value)).toThrow();
    const manifest = await loadManifest();
    for (const table of [
      'recruitment_request_receipts',
      'event_template_versions',
      'scoring_offline_intents',
      'public_archive_operations',
      'staff_configuration_receipts',
    ])
      expect(manifest.tables[table]).toEqual({
        privileges: ['SELECT', 'INSERT'],
        updateColumns: [],
      });
    expect(manifest.tables.scoring_states!.updateColumns).not.toContain('technical_collection');
    expect(manifest.functions['x12_calendar_lock()']).toEqual(['EXECUTE']);
    expect(manifest.functions['x17_staff_receipt_immutable()']).toEqual([]);
  });
});
