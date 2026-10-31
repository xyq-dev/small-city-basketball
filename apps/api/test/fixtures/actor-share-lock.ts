/** Observe the successful actor row lock, independent of selected columns/time-barrier predicates. */
export function actorShareLockQuery(sql: string): boolean {
  const statement = sql.replace(/\s+/g, ' ').trim();
  return (
    /^SELECT /.test(statement) &&
    /\bFROM users(?: u)? WHERE (?:u\.)?id=\$1(?:\s|$)/.test(statement) &&
    /\bFOR SHARE(?: OF (?:u|users))?$/.test(statement)
  );
}
