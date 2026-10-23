import { quoteIdentifier } from '../db/common.mjs';

/** Hash large file bytes in PostgreSQL; never serialize bytea into a Node JSON row. */
export async function exactTableRows(client, table) {
  const name = quoteIdentifier(table);
  if (table !== 'media_files')
    return (
      await client.query(
        `SELECT to_jsonb(t)::text AS value FROM public.${name} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      )
    ).rows;
  const columns = (
    await client.query(
      "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='media_files' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
    )
  ).rows.map((row) => row.attname);
  if (
    !columns.includes('payload') ||
    columns.some((column) => ['payload_length', 'payload_sha256'].includes(column))
  )
    throw new Error('Unexpected media fingerprint schema');
  const metadata = columns
    .filter((column) => column !== 'payload')
    .map(quoteIdentifier)
    .join(',');
  return (
    await client.query(
      `SELECT to_jsonb(t)::text AS value FROM (SELECT ${metadata},octet_length(payload) AS payload_length,encode(sha256(payload),'hex') AS payload_sha256 FROM public.${name}) t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    )
  ).rows;
}
