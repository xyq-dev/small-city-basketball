import { quoteIdentifier } from '../db/common.mjs';

/** Hash large file bytes in PostgreSQL; never serialize bytea into a Node JSON row. */
export async function exactTableRows(client, table) {
  const name = quoteIdentifier(table);
  const binary = {
    media_files: ['payload', 'payload_length', 'payload_sha256', false],
    participant_material_revisions: [
      'payload_ciphertext',
      'stored_payload_length',
      'stored_payload_sha256',
      true,
    ],
    governance_case_attachments: [
      'content',
      'stored_content_length',
      'stored_content_sha256',
      false,
    ],
    account_mail_jobs: ['envelope', 'stored_envelope_length', 'stored_envelope_sha256', false],
  }[table];
  if (!binary)
    return (
      await client.query(
        `SELECT to_jsonb(t)::text AS value FROM public.${name} t ORDER BY to_jsonb(t)::text COLLATE "C"`,
      )
    ).rows;
  const [payloadColumn, lengthColumn, hashColumn, textPayload] = binary;
  const columns = (
    await client.query(
      "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
      [table],
    )
  ).rows.map((row) => row.attname);
  if (
    !columns.includes(payloadColumn) ||
    columns.some((column) => [lengthColumn, hashColumn].includes(column))
  )
    throw new Error('Unexpected media fingerprint schema');
  const metadata = columns
    .filter((column) => column !== payloadColumn)
    .map(quoteIdentifier)
    .join(',');
  const payload = quoteIdentifier(payloadColumn);
  const hashInput = textPayload ? `convert_to(${payload},'UTF8')` : payload;
  return (
    await client.query(
      `SELECT to_jsonb(t)::text AS value FROM (SELECT ${metadata},octet_length(${payload}) AS ${quoteIdentifier(lengthColumn)},encode(sha256(${hashInput}),'hex') AS ${quoteIdentifier(hashColumn)} FROM public.${name}) t ORDER BY to_jsonb(t)::text COLLATE "C"`,
    )
  ).rows;
}
