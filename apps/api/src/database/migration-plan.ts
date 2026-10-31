/** Checked-in migrations form one ordered append-only sequence. */
export function orderedMigrationNames(entries: readonly string[]): string[] {
  const names = entries.filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('No database migrations found');
  names.forEach((name, index) => {
    const number = name.slice(0, name.indexOf('_'));
    if (number !== String(index + 1).padStart(3, '0'))
      throw new Error('Database migration sequence is incomplete or ambiguous');
  });
  return names;
}
export function assertAppliedMigrationPrefix(
  expected: readonly string[],
  applied: readonly string[],
): void {
  if (applied.length > expected.length || applied.some((name, index) => expected[index] !== name))
    throw new Error('Applied database migrations are not an exact known prefix');
}
