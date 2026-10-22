import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

// This black-box check deliberately has no DB/container access and never logs
// responses, credentials, URLs, file names, or underlying exception messages.
let phase = 'configuration';
function check(condition) {
  if (!condition) throw new Error('check failed');
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function privateJson(variable) {
  const path = process.env[variable];
  check(Boolean(path));
  const info = await stat(path);
  check(info.isFile() && (info.mode & 0o077) === 0);
  return JSON.parse(await readFile(path, 'utf8'));
}
function cookie(header, name, path, sameSite) {
  check(typeof header === 'string');
  const parts = header.split(';').map((part) => part.trim());
  check(new RegExp(`^${name.replaceAll('.', '\\.')}=[A-Za-z0-9_-]{43}$`).test(parts[0]));
  const attributes = new Map(
    parts.slice(1).map((part) => {
      const at = part.indexOf('=');
      return at < 0
        ? [part.toLowerCase(), '']
        : [part.slice(0, at).toLowerCase(), part.slice(at + 1)];
    }),
  );
  check(attributes.has('secure') && attributes.has('httponly'));
  check(attributes.get('samesite')?.toLowerCase() === sameSite.toLowerCase());
  check(attributes.get('path') === path && !attributes.has('domain'));
  check(/^\d+$/.test(attributes.get('max-age') ?? ''));
  check(Number(attributes.get('max-age')) > 0);
  return parts[0];
}

try {
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0');
  const base = new URL(process.env.SCB_CHECK_BASE_URL ?? '');
  check(
    base.protocol === 'https:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) &&
      !base.username &&
      !base.password &&
      base.pathname === '/' &&
      !base.search &&
      !base.hash,
  );
  const mode = process.argv[2] ?? 'smoke';
  check(['smoke', 'rate-limit'].includes(mode) && process.argv.length <= 3);
  const origin = base.origin;
  async function request(path, options = {}) {
    const response = await fetch(origin + path, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      ...options,
    });
    const text = await response.text();
    check(text.length < 1_000_000);
    return { response, text };
  }
  async function json(path, options = {}) {
    const result = await request(path, options);
    check(result.response.headers.get('content-type')?.includes('application/json'));
    check(result.response.headers.get('cache-control')?.includes('no-store'));
    return { ...result, body: JSON.parse(result.text) };
  }
  function data(result, status = 200) {
    check(result.response.status === status && record(result.body));
    check(record(result.body.meta) && typeof result.body.meta.requestId === 'string');
    return result.body.data;
  }
  function error(result, status, forbidden = []) {
    check(result.response.status === status && record(result.body?.error));
    check(typeof result.body.error.code === 'string');
    check(typeof result.body.error.requestId === 'string');
    check(!('data' in result.body));
    if ([401, 403, 404].includes(status)) check(!('details' in result.body.error));
    if (result.body.error.details !== undefined) {
      check(record(result.body.error.details));
      const allowed = status === 429 ? ['retryAfter'] : status === 422 ? ['fieldErrors'] : [];
      check(Object.keys(result.body.error.details).every((key) => allowed.includes(key)));
    }
    check(!/<html|<!doctype|SELECT |INSERT |postgres:|password_hash/i.test(result.text));
    for (const value of forbidden) if (value) check(!result.text.includes(value));
  }
  const post = (body, headers = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body),
  });

  if (mode === 'rate-limit') {
    phase = 'registration-peer-rate-limit';
    // This must be the LAST source HTTP/browser stage. Earlier participant
    // registrations may already consume part of the shared 20/hour peer budget.
    // Invalid input consumes that budget before validation without password work.
    let limited = false;
    for (let attempt = 0; attempt < 21; attempt++) {
      const result = await json(
        '/v1/auth/register-participant',
        post(
          {},
          {
            'X-Forwarded-For': `198.51.100.${attempt + 1}`,
            Forwarded: `for=203.0.113.${attempt + 1};proto=http;host=untrusted.invalid`,
            'X-Forwarded-Host': 'untrusted.invalid',
            'X-Forwarded-Proto': 'http',
          },
        ),
      );
      check([422, 429].includes(result.response.status));
      error(result, result.response.status);
      if (result.response.status === 429) {
        limited = true;
        break;
      }
    }
    check(limited);
    for (let attempt = 0; attempt < 3; attempt++) {
      error(
        await json(
          '/v1/auth/register-participant',
          post(
            {},
            {
              'X-Forwarded-For': `203.0.113.${attempt + 101}, 192.0.2.1`,
              Forwarded: `for=192.0.2.${attempt + 1}`,
              'X-Forwarded-Host': 'another.invalid',
              'X-Forwarded-Proto': 'https',
            },
          ),
        ),
        429,
      );
    }
    console.log('P07 HTTPS registration peer limit and forwarded-header rejection: PASS');
  } else {
    const owner = await privateJson('SCB_CHECK_OWNER_FILE');
    const state = await privateJson('SCB_PERSISTENCE_FILE');
    check(
      record(owner) &&
        ['email', 'password', 'displayName', 'organizationName'].every(
          (key) => typeof owner[key] === 'string' && owner[key].length > 0,
        ),
    );
    check(record(state) && record(state.viewing) && record(state.overlays));
    const active = state.overlays.active.find((item) => item.snapshot?.score !== null);
    const revoked = state.overlays.revoked;
    check(active && revoked && typeof state.event?.id === 'string');
    const forbidden = [
      owner.email,
      owner.password,
      state.cookie?.split('=')[1],
      active.cookie?.split('=')[1],
      revoked.cookie?.split('=')[1],
      active.token,
      revoked.token,
    ];
    phase = 'tls-readiness-capabilities';
    check(data(await json('/health')).status === 'ok');
    check(data(await json('/ready')).status === 'ready');
    const capabilities = data(await json('/v1/auth/capabilities'));
    check(record(capabilities));
    check(
      Object.keys(capabilities).sort().join(',') ===
        'canRegisterOrganization,canRegisterParticipant',
    );
    check(
      capabilities.canRegisterOrganization === false &&
        capabilities.canRegisterParticipant === true,
    );

    phase = 'origin-and-closed-registration';
    error(
      await json('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      403,
      forbidden,
    );
    error(
      await json('/v1/auth/login', post({}, { Origin: 'https://untrusted.invalid' })),
      403,
      forbidden,
    );
    error(await json('/v1/auth/register', post({})), 403, forbidden);

    phase = 'secure-private-session';
    const login = await json(
      '/v1/auth/login',
      post(
        { email: owner.email, password: owner.password },
        { 'X-Forwarded-Host': 'untrusted.invalid', 'X-Forwarded-Proto': 'http' },
      ),
    );
    const session = data(login);
    check(typeof session?.user?.id === 'string');
    const sid = cookie(login.response.headers.getSetCookie()[0], 'scb.sid', '/', 'Lax');
    forbidden.push(sid.split('=')[1]);
    check(
      data(await json('/v1/auth/session', { headers: { Cookie: sid } })).user.id ===
        session.user.id,
    );
    const unknown = randomBytes(32).toString('base64url');
    error(await json('/v1/auth/session', { headers: { Cookie: `scb.sid=${unknown}` } }), 401, [
      ...forbidden,
      unknown,
    ]);

    phase = 'spa-deep-links-and-api-404';
    for (const path of [
      `/events/${state.event.id}`,
      `/overlay/${active.overlayId}`,
      `/watch/${state.viewing.publicId}`,
      `/watch/${state.viewing.publicId}/matches/${state.viewing.matches[0].publicMatchId}`,
    ]) {
      const page = await request(path);
      check(
        page.response.status === 200 &&
          page.response.headers.get('content-type')?.includes('text/html'),
      );
      check(page.response.headers.get('cache-control')?.includes('no-store'));
      check(page.text.includes('<div id="root"></div>'));
      for (const secret of [owner.password, active.token, state.cookie])
        check(!page.text.includes(secret));
    }
    error(await json('/v1/definitely-not-a-route'), 404, forbidden);

    phase = 'public-identity-and-revocation';
    const publicEvent = data(await json(`/v1/public/events/${state.viewing.publicId}`));
    check(publicEvent.name === state.viewing.overview.name);
    error(await json(`/v1/public/events/${state.viewing.revokedId}`), 404, forbidden);

    phase = 'dedicated-overlay-cookie-and-secret';
    const path = `/v1/overlays/${active.overlayId}/`;
    const bootstrap = await json(
      path + 'bootstrap',
      post({ token: active.token }, { Cookie: active.cookie }),
    );
    const metadata = data(bootstrap);
    check(
      metadata.overlayId === active.overlayId && metadata.expiresAt === active.snapshot.expiresAt,
    );
    const sourceCookie = cookie(
      bootstrap.response.headers.getSetCookie()[0],
      'scb.overlay',
      path,
      'Strict',
    );
    check(sourceCookie === active.cookie);
    const snapshot = await json(path + 'snapshot', { headers: { Cookie: sourceCookie } });
    check(
      data(snapshot).overlayId === active.overlayId && !snapshot.response.headers.has('set-cookie'),
    );
    check(data(snapshot).score.home === active.snapshot.score.home);
    error(await json(path + 'snapshot'), 404, forbidden);
    error(await json(path + 'snapshot', { headers: { Cookie: sid } }), 404, forbidden);
    error(await json(path + 'bootstrap', post({ token: unknown }, { Cookie: sourceCookie })), 404, [
      ...forbidden,
      unknown,
    ]);
    error(
      await json(path + 'bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: active.token }),
      }),
      403,
      forbidden,
    );
    error(
      await json(
        path + 'bootstrap',
        post({ token: active.token }, { Origin: 'https://untrusted.invalid' }),
      ),
      403,
      forbidden,
    );
    error(
      await json(`/v1/overlays/${revoked.overlayId}/snapshot`, {
        headers: { Cookie: revoked.cookie },
      }),
      404,
      forbidden,
    );
    error(
      await json(`/v1/overlays/${revoked.overlayId}/bootstrap`, post({ token: revoked.token })),
      404,
      forbidden,
    );
    console.log(
      'P07 HTTPS TLS, readiness, capabilities, Cookie, Origin, SPA and anonymous read checks: PASS',
    );
  }
} catch {
  console.error(`P07 HTTPS check failed at ${phase}; sensitive diagnostics suppressed.`);
  process.exitCode = 1;
}
