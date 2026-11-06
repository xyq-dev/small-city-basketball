import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { browserFixtureDatabaseUrl } from './prepare-api-browser-owner.mjs';

// This is only a loopback test transport, never a deployable TLS terminator.
// Validate before creating a certificate or binding a socket; do not read .env.
const database = new URL(browserFixtureDatabaseUrl());
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
  database.search ||
  database.hash
)
  throw new Error('Account security checks require a loopback database without URL parameters');
const directory = await mkdtemp(join(tmpdir(), 'scb-account-security-tls-'));
let server;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server?.close();
  server?.closeAllConnections();
  await rm(directory, { recursive: true, force: true });
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
try {
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  const generated = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore', timeout: 15000 },
  );
  if (generated.status !== 0) throw new Error('Certificate generation failed');
  server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (incoming, outgoing) => {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: 4273,
          method: incoming.method,
          path: incoming.url,
          headers: { ...incoming.headers, host: '127.0.0.1:4273' },
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end('Isolated test upstream unavailable');
      });
      incoming.on('aborted', () => upstream.destroy());
      outgoing.on('close', () => upstream.destroy());
      incoming.pipe(upstream);
    },
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4473, '127.0.0.1', resolve);
  });
  console.log('[account-security] isolated HTTPS transport ready');
} catch {
  await stop();
  console.error('Isolated HTTPS transport failed; verify OpenSSL and loopback ports.');
  process.exitCode = 1;
}
