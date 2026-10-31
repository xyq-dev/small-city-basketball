import { describe, expect, test } from 'vitest';
import { assertAppliedMigrationPrefix, orderedMigrationNames } from './migration-plan.js';
describe('append-only migration plan', () => {
  const files = ['001_base.sql', '002_roster.sql', '003_schedule.sql'];
  test('orders the complete sequence and permits an empty or exact old prefix', () => {
    expect(orderedMigrationNames(['README.md', files[2]!, files[0]!, files[1]!])).toEqual(files);
    expect(() => assertAppliedMigrationPrefix(files, [])).not.toThrow();
    expect(() => assertAppliedMigrationPrefix(files, files.slice(0, 2))).not.toThrow();
    expect(() => assertAppliedMigrationPrefix(files, files)).not.toThrow();
  });
  test('rejects missing, duplicate, noncanonical or zero sequence numbers before SQL runs', () => {
    for (const input of [
      [],
      ['001_a.sql', '003_c.sql'],
      ['001_a.sql', '001_b.sql'],
      ['000_a.sql'],
      ['1_a.sql'],
    ])
      expect(() => orderedMigrationNames(input)).toThrow();
  });
  test('rejects holes, renamed histories, extra applied migrations and retroactive insertion', () => {
    for (const applied of [
      [files[1]!],
      [files[0]!, files[2]!],
      ['001_renamed.sql'],
      [...files, '004_future.sql'],
    ])
      expect(() => assertAppliedMigrationPrefix(files, applied)).toThrow();
    expect(() =>
      assertAppliedMigrationPrefix(
        ['001_base.sql', '002_inserted.sql', '003_old.sql'],
        ['001_base.sql', '003_old.sql'],
      ),
    ).toThrow();
  });
});
