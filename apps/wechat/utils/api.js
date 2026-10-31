// Fixed build-time origin. Shared links and QR payloads never select a server.
const API_ORIGIN = 'https://basketball.playhubs.cn';
const opaque = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidRegex = new RegExp('^' + uuidPattern + '$', 'i');
function uuid(value) {
  if (typeof value !== 'string' || !uuidRegex.test(value)) throw new Error('资料编号无效');
  return value;
}
function publicId(value) {
  if (typeof value !== 'string' || !opaque.test(value)) throw new Error('观赛链接无效');
  return value;
}
function queryValues(raw) {
  const values = Object.create(null);
  if (!raw) return values;
  for (const pair of raw.split('&')) {
    const split = pair.indexOf('=');
    if (split < 1) return null;
    let key, value;
    try {
      key = decodeURIComponent(pair.slice(0, split));
      value = decodeURIComponent(pair.slice(split + 1));
    } catch {
      return null;
    }
    if (
      Object.prototype.hasOwnProperty.call(values, key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      return null;
    if (value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
    values[key] = value;
  }
  return values;
}
function queryAllowed(query, keys) {
  return query && Object.keys(query).every((key) => keys.includes(key));
}
function pathAllowed(path, method = 'GET') {
  if (
    typeof path !== 'string' ||
    path.length > 8500 ||
    path.includes('..') ||
    path.includes('#') ||
    path.includes('://') ||
    /[\u0000-\u0020\\]/.test(path)
  )
    return false;
  const parts = path.split('?');
  if (parts.length > 2) return false;
  const base = parts[0],
    query = queryValues(parts[1]);
  if (!query) return false;
  const noQuery = Object.keys(query).length === 0;
  const matches = (value) => new RegExp('^' + value + '$', 'i').test(base);
  const auth = {
    '/v1/auth/capabilities': 'GET',
    '/v1/auth/session': 'GET',
    '/v1/auth/login': 'POST',
    '/v1/auth/logout': 'POST',
    '/v1/auth/register-participant': 'POST',
    '/v1/auth/wechat/capabilities': 'GET',
    '/v1/auth/wechat/binding': 'GET',
    '/v1/auth/wechat/challenges': 'POST',
    '/v1/auth/wechat/login': 'POST',
    '/v1/auth/wechat/bind': 'POST',
    '/v1/auth/wechat/unbind': 'POST',
  };
  if (Object.prototype.hasOwnProperty.call(auth, base)) return noQuery && auth[base] === method;
  if (['/v1/account-recovery/capabilities', '/v1/account-recovery/me'].includes(base))
    return noQuery && method === 'GET';
  if (
    ['reset-requests', 'verification-requests', 'consume', 'receipts', 'cancel'].some(
      (v) => base === '/v1/account-recovery/' + v,
    )
  )
    return noQuery && method === 'POST';
  if (matches('/v1/orgs/' + uuidPattern + '/staff-configuration'))
    return (
      method === 'GET' &&
      queryAllowed(query, ['eventId']) &&
      (!query.eventId || uuidRegex.test(query.eventId))
    );
  if (matches('/v1/orgs/' + uuidPattern + '/staff-configuration/commands'))
    return noQuery && method === 'POST';
  if (base === '/v1/public/regions') return method === 'GET' && parts.length === 1;
  // Public directory: exact parameters only; sent without any session cookie.
  if (base === '/v1/public/directory')
    return (
      method === 'GET' &&
      queryAllowed(query, ['status', 'limit', 'city', 'cursor', 'regionId', 'catalogVersion']) &&
      'regionId' in query === 'catalogVersion' in query &&
      (!('regionId' in query) ||
        (!('city' in query) &&
          uuidRegex.test(query.regionId) &&
          /^[a-z0-9][a-z0-9-]{0,63}$/.test(query.catalogVersion))) &&
      (!('status' in query) || ['LIVE', 'UPCOMING', 'HISTORY'].includes(query.status)) &&
      (!('limit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit)) &&
      (!('city' in query) || (query.city.length >= 1 && query.city.length <= 40)) &&
      (!('cursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.cursor))
    );
  const root = '/v1/player-bookings';
  if (base === root + '/workspace') return noQuery && method === 'GET';
  if ([root + '/profile', root + '/settings'].includes(base)) return noQuery && method === 'PUT';
  if (base === root + '/orders') return noQuery && method === 'POST';
  if (matches(root + '/orders/' + uuidPattern)) return noQuery && method === 'GET';
  if (
    matches(root + '/orders/' + uuidPattern + '/commands') ||
    matches(root + '/profiles/' + uuidPattern + '/review')
  )
    return noQuery && method === 'POST';
  if (base === root + '/players/performance') {
    if (method !== 'GET' || !queryAllowed(query, ['ids']) || !query.ids) return false;
    const ids = query.ids.split(',');
    return (
      ids.length > 0 &&
      ids.length <= 20 &&
      ids.every((v) => uuidRegex.test(v)) &&
      new Set(ids).size === ids.length
    );
  }
  if (matches(root + '/players/' + uuidPattern + '/performance'))
    return noQuery && method === 'GET';
  if (base === root + '/performance/workspace')
    return (
      method === 'GET' &&
      queryAllowed(query, ['cursor']) &&
      (!('cursor' in query) || !!query.cursor)
    );
  if (base === root + '/performance/sources')
    return (
      method === 'GET' &&
      queryAllowed(query, ['orgId', 'eventId']) &&
      uuidRegex.test(query.orgId || '') &&
      uuidRegex.test(query.eventId || '')
    );
  if (base === root + '/performance/links') return noQuery && method === 'POST';
  if (matches(root + '/performance/links/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(root + '/performance/links/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  // C23 private participant materials: explicit methods, no anonymous or query access.
  if (base === '/v1/me/participant-entries') return noQuery && method === 'GET';
  const org = '/v1/orgs/' + uuidPattern;
  const tokenPattern = '[A-Za-z0-9_-]{43}';
  const beforePage = (extra = []) =>
    method === 'GET' &&
    queryAllowed(query, ['before', 'limit', ...extra]) &&
    (!query.before || uuidRegex.test(query.before)) &&
    (!query.limit || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit));
  if (matches('/v1/public/recruitments/' + tokenPattern)) return noQuery && method === 'GET';
  if (matches('/v1/public/recruitments/' + tokenPattern + '/applications'))
    return noQuery && method === 'POST';
  if (base === '/v1/public/local-listings')
    return (
      method === 'GET' &&
      queryAllowed(query, ['regionId', 'catalogVersion', 'kind', 'q', 'limit', 'cursor']) &&
      'regionId' in query === 'catalogVersion' in query &&
      (!query.regionId || uuidRegex.test(query.regionId))
    );
  if (matches('/v1/public/local-listings/' + uuidPattern)) return noQuery && method === 'GET';
  if (['/v1/public/local-search', '/v1/public/local-location'].includes(base))
    return noQuery && method === 'POST';
  if (matches('/v1/public/governance/reviews/' + tokenPattern)) return noQuery && method === 'GET';
  if (matches(org + '/sponsorships'))
    return method === 'GET' ? beforePage() : noQuery && method === 'POST';
  if (matches(org + '/sponsorships/options'))
    return method === 'GET' && queryAllowed(query, ['query']);
  if (matches(org + '/sponsorships/' + uuidPattern))
    return noQuery && ['GET', 'PUT'].includes(method);
  if (
    matches(org + '/sponsorships/' + uuidPattern + '/commands') ||
    matches('/v1/me/sponsorships/' + uuidPattern + '/commands')
  )
    return noQuery && method === 'POST';
  if (base === '/v1/me/sponsorships/review-queue') return beforePage();
  if (base === '/v1/public/sponsorships')
    return (
      method === 'GET' &&
      queryAllowed(query, ['regionId', 'catalogVersion', 'eventPublicId', 'limit']) &&
      uuidRegex.test(query.regionId || '') &&
      !!query.catalogVersion &&
      (!query.eventPublicId || opaque.test(query.eventPublicId))
    );
  if (matches('/v1/public/sponsorships/' + tokenPattern)) return noQuery && method === 'GET';
  if (matches('/v1/public/sponsorships/' + tokenPattern + '/impressions'))
    return noQuery && method === 'POST';
  if (base === '/v1/me/public-archives') return noQuery && ['GET', 'POST'].includes(method);
  if (matches('/v1/me/public-archives/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches(org + '/events/' + uuidPattern + '/public-archive-sources'))
    return noQuery && method === 'GET';
  if (
    base === '/v1/public-archive-sources' ||
    matches('/v1/public-archive-sources/' + uuidPattern + '/commands')
  )
    return noQuery && method === 'POST';
  if (base === '/v1/public/archives/rankings')
    return (
      method === 'GET' && queryAllowed(query, ['kind']) && ['PLAYER', 'TEAM'].includes(query.kind)
    );
  if (matches('/v1/public/archives/' + tokenPattern)) return noQuery && method === 'GET';
  if (matches(org + '/event-templates')) return noQuery && method === 'GET';
  if (matches(org + '/event-template-commands')) return noQuery && method === 'POST';
  if (matches(org + '/event-template-commands/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/setup-guide')) return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/exception-rules'))
    return noQuery && ['GET', 'PUT'].includes(method);
  if (matches(org + '/matches/' + uuidPattern + '/exceptions')) return noQuery && method === 'GET';
  if (
    matches(org + '/matches/' + uuidPattern + '/exceptions/(proposals|' + uuidPattern + '/review)')
  )
    return noQuery && method === 'POST';
  if (
    matches(org + '/schedule-revisions/' + uuidPattern + '/optimization-preview') ||
    matches(org + '/events/' + uuidPattern + '/(knockout|group)-optimization-preview')
  )
    return noQuery && method === 'POST';
  const eventRoot = org + '/events/' + uuidPattern;
  if (matches(eventRoot + '/recruitment')) return noQuery && method === 'GET';
  if (matches(eventRoot + '/recruitment/(publish|revoke)')) return noQuery && method === 'POST';
  if (matches(eventRoot + '/(recruitment-applications|event-invitations)'))
    return method === 'GET'
      ? beforePage()
      : noQuery && method === 'POST' && base.endsWith('/event-invitations');
  if (
    matches(eventRoot + '/recruitment-applications/' + uuidPattern + '/commands') ||
    matches(eventRoot + '/team-import/(previews|commit)')
  )
    return noQuery && method === 'POST';
  if (matches('/v1/me/(recruitment-applications|event-invitations)')) return beforePage();
  if (matches('/v1/me/recruitment-requests/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches('/v1/event-invitations/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches(eventRoot + '/posters')) return noQuery && ['GET', 'POST'].includes(method);
  if (matches(eventRoot + '/posters/' + uuidPattern + '/revoke'))
    return noQuery && method === 'POST';
  if (matches(org + '/local-services(?:/options|/listings/' + uuidPattern + ')?'))
    return noQuery && method === 'GET';
  if (matches(org + '/local-services/listings')) return noQuery && method === 'POST';
  if (matches('/v1/local-services/(mine|receipts/' + uuidPattern + ')'))
    return noQuery && method === 'GET';
  if (matches('/v1/local-services/listings/' + uuidPattern))
    return noQuery && ['GET', 'PUT'].includes(method);
  if (
    matches(
      '/v1/local-services/listings/' +
        uuidPattern +
        '/(commands|slots|slots/' +
        uuidPattern +
        '/close)',
    )
  )
    return noQuery && method === 'POST';
  if (['/v1/local-bookings', '/v1/local-matchups'].includes(base))
    return noQuery && ['GET', 'POST'].includes(method);
  if (matches('/v1/local-bookings/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches('/v1/local-(bookings|matchups)/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches('/v1/(me|platform)/governance/(cases|reviews)'))
    return method === 'GET'
      ? beforePage(['assigned'])
      : base.startsWith('/v1/me/') && noQuery && method === 'POST';
  const govCase = '/v1/me/governance/cases/' + uuidPattern;
  if (matches(govCase + '(?:/assignees)?')) return noQuery && method === 'GET';
  if (matches(govCase + '/messages'))
    return method === 'GET' ? beforePage() : noQuery && method === 'POST';
  if (matches(govCase + '/commands')) return noQuery && method === 'POST';
  if (matches(govCase + '/attachments/' + uuidPattern)) return noQuery && method === 'PUT';
  if (matches(govCase + '/attachment-receipts/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches('/v1/me/governance/reviews/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches('/v1/me/governance/operations/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches('/v1/me/governance/operations/' + uuidPattern + '/cancel'))
    return noQuery && method === 'POST';
  if (matches('/v1/(me|platform)/city-operations')) return beforePage(['orgQuery', 'userQuery']);
  if (matches('/v1/platform/city-operations/grants(?:/' + uuidPattern + '/revoke)?'))
    return noQuery && method === 'POST';

  const participant = org + '/entries/' + uuidPattern + '/participant-materials';
  if (matches(participant)) return noQuery && method === 'GET';
  if (matches(participant + '/mine')) return noQuery && ['GET', 'PUT'].includes(method);
  if (matches(participant + '/mine/(submit|publicity-withdraw)'))
    return noQuery && method === 'POST';
  if (matches(participant + '/mine/receipts/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(participant + '/' + uuidPattern + '(?:/private)?'))
    return noQuery && method === 'GET';
  if (matches(participant + '/' + uuidPattern + '/review')) return noQuery && method === 'POST';
  const paged =
    method === 'GET' &&
    queryAllowed(query, ['limit', 'cursor']) &&
    (!query.limit || ['50', '100'].includes(query.limit));
  const cursor = (value) => /^[A-Za-z0-9_%.-]{1,2048}$/.test(value);
  // Event-platform reads plus the role-checked commands that already exist server-side:
  // scoring (lease + idempotent commands), independent result confirmation, registration
  // review and lifecycle. Every write is re-authorized by the API; the client never decides.
  if (matches(org + '/scoring-matches'))
    return (
      method === 'GET' &&
      queryAllowed(query, ['eventId', 'limit', 'cursor']) &&
      (!query.eventId || uuidRegex.test(query.eventId)) &&
      (!query.limit || ['50', '100'].includes(query.limit)) &&
      (!('cursor' in query) || cursor(query.cursor))
    );
  const match = org + '/matches/' + uuidPattern;
  if (matches(match + '/(scoring|snapshot)')) return noQuery && method === 'GET';
  if (matches(match + '/(scoring-events|result-confirmations)')) return paged;
  if (matches(match + '/offline-intents')) return noQuery && method === 'POST';
  if (matches(match + '/offline-intents/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(match + '/commands')) return noQuery && method === 'POST';
  if (matches(match + '/commands/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(match + '/scorekeeper-lease')) return noQuery && ['POST', 'DELETE'].includes(method);
  if (matches(match + '/scorekeeper-lease/renew')) return noQuery && method === 'POST';
  if (matches(org + '/events/' + uuidPattern + '/(lifecycle|scoring)'))
    return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/(lifecycle-commands|registration-commands)'))
    return noQuery && method === 'POST';
  if (matches(org + '/events'))
    return method === 'POST'
      ? noQuery
      : method === 'GET' &&
          queryAllowed(query, ['limit', 'cursor']) &&
          query.limit === '50' &&
          (!('cursor' in query) || /^[A-Za-z0-9_-]{1,2048}$/.test(query.cursor));
  if (matches(org + '/events/' + uuidPattern)) return noQuery && ['GET', 'PATCH'].includes(method);
  // Event setup and round-robin scheduling: forms over existing role-checked commands.
  if (
    matches(org + '/events/' + uuidPattern + '/(registration-rules|scoring-rules|standings-rules)')
  )
    return noQuery && method === 'PUT';
  if (
    matches(
      org +
        '/events/' +
        uuidPattern +
        '/(standings-rule-commands|public-viewing-commands|schedule-revisions)',
    )
  )
    return noQuery && method === 'POST';
  if (matches(org + '/events/' + uuidPattern + '/scheduling')) return noQuery && method === 'GET';
  if (matches(org + '/courts')) return method === 'GET' ? paged : noQuery && method === 'POST';
  if (matches(org + '/courts/' + uuidPattern)) return noQuery && method === 'PATCH';
  const revision = org + '/schedule-revisions/' + uuidPattern;
  if (matches(revision)) return noQuery && method === 'GET';
  if (matches(revision + '/allocations')) return noQuery && method === 'PUT';
  if (matches(revision + '/(validate|publish)')) return noQuery && method === 'POST';
  if (matches(org + '/members')) return noQuery && method === 'GET';
  if (matches(match + '/staff/' + uuidPattern)) return noQuery && method === 'PUT';
  if (matches(org + '/events/' + uuidPattern + '/(standings|groups|knockout|player-statistics)'))
    return noQuery && method === 'GET';
  // C18: directory status and explicit LIST/UNLIST (role-checked and CAS-checked by the API).
  if (matches(org + '/events/' + uuidPattern + '/directory')) return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/directory-commands'))
    return noQuery && method === 'POST';
  // C15/C16: group tie draws, qualification and knockout round publication, formal
  // rescheduling and match media (files incl. revoke/purge, drafts, publish/revoke, time
  // markers). Each command is CAS-checked and role-checked by the API.
  if (
    matches(
      org +
        '/events/' +
        uuidPattern +
        '/(group-tie-commands|group-qualification-commands|knockout-round-commands)',
    )
  )
    return noQuery && method === 'POST';
  if (matches(match + '/rescheduling')) return noQuery && method === 'GET';
  if (matches(match + '/reschedule-commands')) return noQuery && method === 'POST';
  if (matches(match + '/media')) return noQuery && ['GET', 'POST'].includes(method);
  if (matches(match + '/media-files')) return noQuery && method === 'POST';
  if (matches(match + '/media-files/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches(match + '/media/' + uuidPattern + '/(commands|markers)'))
    return noQuery && method === 'POST';
  if (matches(org + '/events/' + uuidPattern + '/matches')) return paged;
  if (matches(org + '/teams')) return method === 'GET' ? paged : noQuery && method === 'POST';
  if (matches(org + '/teams/' + uuidPattern)) return noQuery && ['GET', 'PATCH'].includes(method);
  if (matches(org + '/teams/' + uuidPattern + '/members')) return noQuery && method === 'PUT';
  if (matches(org + '/teams/' + uuidPattern + '/registration-events')) return paged;
  if (matches(org + '/events/' + uuidPattern + '/registration')) return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/entries'))
    return method === 'GET' ? paged : noQuery && method === 'POST';
  if (matches(org + '/entries/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(org + '/entries/' + uuidPattern + '/roster')) return noQuery && method === 'PUT';
  if (matches(org + '/entries/' + uuidPattern + '/commands')) return noQuery && method === 'POST';
  if (matches(org + '/entries/' + uuidPattern + '/media-files'))
    return noQuery && ['GET', 'POST'].includes(method);
  if (matches(org + '/entries/' + uuidPattern + '/media-files/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (matches(org + '/entries/' + uuidPattern + '/media-files/' + uuidPattern + '/content'))
    return noQuery && method === 'GET';
  if (matches('/v1/invitations/' + uuidPattern + '/accept')) return noQuery && method === 'POST';
  // C19 (docs/design/C19_CONTRACTS.md). Every route below is re-authorized server-side.
  // Media request idempotency and chunked upload sessions (match media only).
  if (matches(match + '/(media-file-requests|media-requests|media-upload-sessions)'))
    return noQuery && method === 'POST';
  if (matches(match + '/(media-file-requests|media-requests)/' + uuidPattern))
    return noQuery && method === 'GET';
  if (matches(match + '/media-upload-sessions/' + uuidPattern)) return noQuery && method === 'GET';
  if (matches(match + '/media-upload-sessions/' + uuidPattern + '/(complete|cancel)'))
    return noQuery && method === 'POST';
  if (matches(match + '/media-upload-sessions/' + uuidPattern + '/chunks/(0|[1-9][0-9]?)'))
    return noQuery && method === 'PUT';
  // Team requests, join codes, member bindings and historical member claims.
  const me = '/v1/me';
  if (matches(org + '/(team-request-links|team-requests)')) {
    if (base.endsWith('/team-request-links'))
      return method === 'POST' ? noQuery : noQuery && method === 'GET';
    return (
      method === 'GET' &&
      queryAllowed(query, ['status']) &&
      (!('status' in query) ||
        ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(query.status))
    );
  }
  if (matches(org + '/team-request-links/' + uuidPattern + '/revoke'))
    return noQuery && method === 'POST';
  if (matches(org + '/team-requests/' + uuidPattern + '/review'))
    return noQuery && method === 'POST';
  if (['/v1/team-request-links/resolve', '/v1/team-requests', '/v1/team-joins'].includes(base))
    return noQuery && method === 'POST';
  if ([me + '/team-requests', me + '/member-claims', me + '/memberships'].includes(base))
    return noQuery && method === 'GET';
  if (matches(me + '/team-requests/' + uuidPattern + '/withdraw'))
    return noQuery && method === 'POST';
  if (matches(me + '/member-claims/' + uuidPattern + '/(accept|decline)'))
    return noQuery && method === 'POST';
  if (matches(me + '/memberships/' + uuidPattern + '/team')) return noQuery && method === 'GET';
  if (matches(me + '/memberships/' + uuidPattern + '/leave')) return noQuery && method === 'POST';
  const team = org + '/teams/' + uuidPattern;
  if (matches(team + '/join-codes')) return noQuery && ['GET', 'POST'].includes(method);
  if (matches(team + '/join-codes/' + uuidPattern + '/revoke')) return noQuery && method === 'POST';
  if (matches(team + '/member-bindings')) return noQuery && method === 'GET';
  if (matches(team + '/member-bindings/' + uuidPattern + '/remove'))
    return noQuery && method === 'POST';
  if (matches(team + '/members/' + uuidPattern + '/claims')) return noQuery && method === 'POST';
  if (matches(team + '/member-claims/' + uuidPattern + '/revoke'))
    return noQuery && method === 'POST';
  // Event follows (own account only).
  if (base === me + '/follows')
    return method === 'POST'
      ? noQuery
      : method === 'GET' &&
          queryAllowed(query, ['limit', 'cursor']) &&
          (!('limit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit)) &&
          (!('cursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.cursor));
  if (base === me + '/follows/lookup')
    return (
      method === 'GET' &&
      queryAllowed(query, ['publicEventId']) &&
      /^[A-Za-z0-9_-]{43}$/.test(query.publicEventId || '')
    );
  if (matches(me + '/follows/' + uuidPattern + '/cancel')) return noQuery && method === 'POST';
  // Private seasons and independent PRIVATE_SEASON data grants.
  if (matches(org + '/seasons'))
    return method === 'POST'
      ? noQuery
      : method === 'GET' &&
          queryAllowed(query, ['limit', 'cursor']) &&
          (!('limit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit)) &&
          (!('cursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.cursor));
  if (matches(org + '/seasons/' + uuidPattern))
    return method === 'PATCH'
      ? noQuery
      : method === 'GET' &&
          queryAllowed(query, ['candidateLimit', 'candidateCursor']) &&
          (!('candidateLimit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.candidateLimit)) &&
          (!('candidateCursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.candidateCursor));
  if (matches(org + '/seasons/' + uuidPattern + '/commands')) return noQuery && method === 'POST';
  if (matches(org + '/seasons/' + uuidPattern + '/player-statistics'))
    return noQuery && method === 'GET';
  if (matches(org + '/events/' + uuidPattern + '/season-data-grants'))
    return method === 'POST'
      ? noQuery
      : method === 'GET' &&
          queryAllowed(query, ['limit', 'cursor']) &&
          (!('limit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit)) &&
          (!('cursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.cursor));
  if (matches(org + '/season-data-grants/' + uuidPattern + '/withdraw'))
    return noQuery && method === 'POST';
  if (base === me + '/season-data-grants')
    return (
      method === 'GET' &&
      queryAllowed(query, ['limit', 'cursor']) &&
      (!('limit' in query) || /^(?:[1-9]|[1-4]\d|50)$/.test(query.limit)) &&
      (!('cursor' in query) || /^[A-Za-z0-9_-]{1,512}$/.test(query.cursor))
    );
  if (matches(me + '/season-data-grants/' + uuidPattern + '/commands'))
    return noQuery && method === 'POST';
  if (base === me + '/season-statistics')
    return (
      method === 'GET' &&
      queryAllowed(query, ['orgId', 'seasonId']) &&
      uuidRegex.test(query.orgId || '') &&
      uuidRegex.test(query.seasonId || '')
    );
  return (
    method === 'GET' &&
    /^\/v1\/public\/events\/[A-Za-z0-9_-]{43}(?:\/(standings|knockout|groups|schedule|matches\/[A-Za-z0-9_-]{43}(?:\/media)?))?(?:\?limit=50(?:&cursor=[A-Za-z0-9_%.-]+)?)?$/.test(
      path,
    )
  );
}
function createClient(wxApi) {
  let cookie = '',
    revision = 0,
    actor = null;
  const listeners = new Set();
  function notify(reason) {
    // Iterate a snapshot: a listener that re-subscribes while being notified (ui.subscribe on a
    // page reset) would otherwise be appended to the live Set and revisited without end. A
    // listener removed earlier in this same notification no longer runs.
    for (const listener of Array.from(listeners)) {
      if (!listeners.has(listener)) continue;
      try {
        listener(revision, reason);
      } catch {
        /* A closed view cannot prevent session invalidation. */
      }
    }
  }
  function invalidate(reason) {
    cookie = '';
    actor = null;
    revision++;
    notify(reason);
  }
  // `timeout` is only raised for a single media upload (one JSON body of up to ~11 MB base64).
  function request(path, method = 'GET', body, anonymous = false, timeout = 8000) {
    if (
      !pathAllowed(path, method) ||
      (anonymous &&
        !(
          (method === 'GET' &&
            (/^\/v1\/public\/recruitments\/[A-Za-z0-9_-]{43}$/.test(path) ||
              /^\/v1\/public\/local-listings(?:\?|\/|$)/.test(path) ||
              /^\/v1\/public\/governance\/reviews\/[A-Za-z0-9_-]{43}$/.test(path))) ||
          (method === 'POST' &&
            ['/v1/public/local-search', '/v1/public/local-location'].includes(path)) ||
          (method === 'GET' && /^\/v1\/public\/sponsorships(?:\?|\/|$)/.test(path)) ||
          (method === 'POST' &&
            /^\/v1\/public\/sponsorships\/[A-Za-z0-9_-]{43}\/impressions$/.test(path)) ||
          (method === 'GET' && /^\/v1\/public\/events\/[A-Za-z0-9_-]{43}(?:\/|\?|$)/.test(path)) ||
          (method === 'GET' &&
            /^\/v1\/public\/archives\/(?:[A-Za-z0-9_-]{43}$|rankings\?)/.test(path)) ||
          (path === '/v1/account-recovery/capabilities' && method === 'GET') ||
          (['reset-requests', 'consume', 'receipts', 'cancel'].some(
            (v) => path === '/v1/account-recovery/' + v,
          ) &&
            method === 'POST') ||
          (method === 'GET' &&
            (/^\/v1\/player-bookings\/players\//.test(path) ||
              /^\/v1\/public\/directory(?:\?|$)/.test(path) ||
              path === '/v1/public/regions'))
        ))
    )
      return Promise.reject({ code: 'INVALID_PATH', message: '请求入口无效' });
    if (
      !anonymous &&
      method === 'POST' &&
      ['/v1/auth/login', '/v1/auth/wechat/login', '/v1/auth/register-participant'].includes(path)
    )
      invalidate('LOGIN');
    const started = revision;
    return new Promise((resolve, reject) =>
      wxApi.request({
        url: API_ORIGIN + path,
        method,
        timeout: Math.min(Math.max(Number(timeout) || 8000, 8000), 120000),
        data: body,
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: API_ORIGIN,
          ...(!anonymous && cookie ? { Cookie: cookie } : {}),
        },
        success(response) {
          if (!anonymous && started !== revision) {
            reject({ code: 'SESSION_CHANGED', message: '登录身份已变化，请重新读取。' });
            return;
          }
          if (!anonymous) {
            const headers = response.header || {};
            const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie');
            const records = [
              ...(key ? [String(headers[key])] : []),
              ...(Array.isArray(response.cookies)
                ? response.cookies.filter((v) => typeof v === 'string')
                : []),
            ];
            const tokens = new Set();
            for (const raw of records) {
              const sid = /(?:^|[,;]\s*)scb\.sid=([A-Za-z0-9_-]{43})(?:;|$)/.exec(raw);
              if (sid) tokens.add(sid[1]);
            }
            if (tokens.size === 1) cookie = 'scb.sid=' + [...tokens][0];
            if (tokens.size > 1 || records.some((raw) => /(?:^|[,;]\s*)scb\.sid=(?:;|$)/.test(raw)))
              cookie = '';
            if (response.statusCode === 401) invalidate('UNAUTHENTICATED');
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = response.data && response.data.error;
            reject({
              code: (error && error.code) || 'HTTP_ERROR',
              status: response.statusCode,
              message: (error && error.message) || '资料暂时不可用',
              details:
                error &&
                error.details &&
                typeof error.details === 'object' &&
                !Array.isArray(error.details)
                  ? error.details
                  : undefined,
            });
            return;
          }
          const payload = response.data;
          if (
            !payload ||
            !Object.prototype.hasOwnProperty.call(payload, 'data') ||
            !payload.meta ||
            typeof payload.meta.requestId !== 'string'
          ) {
            reject({ code: 'INVALID_RESPONSE', message: '服务返回格式无效' });
            return;
          }
          if (
            !anonymous &&
            [
              '/v1/auth/session',
              '/v1/auth/login',
              '/v1/auth/wechat/login',
              '/v1/auth/register-participant',
            ].includes(path) &&
            payload.data &&
            payload.data.user &&
            typeof payload.data.user.id === 'string'
          ) {
            const next = payload.data.user.id;
            if (actor !== next) {
              actor = next;
              revision++;
              notify('ACTOR');
            }
          }
          resolve(payload);
        },
        fail() {
          reject({
            code: 'NETWORK_ERROR',
            message: '网络连接中断，请恢复连接后刷新；原操作结果可能尚未核对。',
          });
        },
      }),
    );
  }
  return {
    request,
    download(path) {
      // Private file content only: registration files (PDF/images) and match media (images/MP4).
      const content = new RegExp(
        '^/v1/orgs/' +
          uuidPattern +
          '/(entries|matches)/' +
          uuidPattern +
          '/media-files/' +
          uuidPattern +
          '/content$',
        'i',
      );
      const participant = new RegExp(
        '^/v1/orgs/' +
          uuidPattern +
          '/entries/' +
          uuidPattern +
          '/participant-materials/' +
          uuidPattern +
          '/files/(portrait|insurance)$',
        'i',
      ).test(path);
      const poster = new RegExp(
        '^/v1/orgs/' +
          uuidPattern +
          '/events/' +
          uuidPattern +
          '/posters/' +
          uuidPattern +
          '/content$',
        'i',
      ).test(path);
      const evidence = new RegExp(
        '^/v1/me/governance/cases/' + uuidPattern + '/attachments/' + uuidPattern + '/content$',
        'i',
      ).test(path);
      const scope = poster
        ? 'poster'
        : evidence
          ? 'evidence'
          : participant
            ? 'participant'
            : (content.exec(path) || [])[1];
      if (!scope) return Promise.reject({ code: 'INVALID_PATH', message: '文件入口无效' });
      const allowed =
        scope === 'poster'
          ? ['image/png']
          : scope.toLowerCase() === 'matches'
            ? ['image/png', 'image/jpeg', 'video/mp4']
            : ['image/png', 'image/jpeg', 'application/pdf'];
      const started = revision;
      return new Promise((resolve, reject) =>
        wxApi.request({
          url: API_ORIGIN + path,
          method: 'GET',
          timeout: scope.toLowerCase() === 'matches' ? 60000 : 15000,
          responseType: 'arraybuffer',
          header: { Origin: API_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
          success(response) {
            if (started !== revision) {
              reject({ code: 'SESSION_CHANGED', message: '登录身份已变化，已停止查看文件。' });
              return;
            }
            if (response.statusCode === 401) invalidate('UNAUTHENTICATED');
            if (response.statusCode !== 200) {
              reject({
                status: response.statusCode,
                code: 'FILE_UNAVAILABLE',
                message: '文件不可读取，可能已撤销或权限变化。',
              });
              return;
            }
            const headers = response.header || {};
            const key = Object.keys(headers).find((v) => v.toLowerCase() === 'content-type');
            const contentType = String(key ? headers[key] : '')
              .split(';')[0]
              .toLowerCase();
            const data = response.data;
            if (
              !allowed.includes(contentType) ||
              !data ||
              !Number.isSafeInteger(data.byteLength) ||
              data.byteLength < 1 ||
              data.byteLength > 8 * 1024 * 1024
            ) {
              reject({ code: 'INVALID_FILE', message: '文件格式或容量不符合要求，已停止查看。' });
              return;
            }
            resolve({ data, contentType });
          },
          fail() {
            reject({ code: 'NETWORK_ERROR', message: '文件读取中断，请重新核对权限后再试。' });
          },
        }),
      );
    },
    requestPublic(path) {
      return request(path, 'GET', undefined, true);
    },
    sessionRevision() {
      return revision;
    },
    viewerId() {
      return actor;
    },
    onSessionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clearSession() {
      invalidate('CLEARED');
    },
    hasSession() {
      return !!cookie;
    },
  };
}
let instance;
function getClient() {
  if (!instance) instance = createClient(wx);
  return instance;
}
function eventFromInput(value) {
  const input = String(value || '').trim();
  const match = /^https:\/\/basketball\.playhubs\.cn\/watch\/([A-Za-z0-9_-]{43})\/?$/.exec(input);
  return publicId(match ? match[1] : input);
}
async function allSchedule(client, event) {
  let cursor = null;
  let rows = [];
  for (let page = 0; page < 20; page++) {
    const response = await client.request(
      '/v1/public/events/' +
        publicId(event) +
        '/schedule?limit=50' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      'GET',
      undefined,
      true,
    );
    if (!Array.isArray(response.data)) throw new Error('赛程资料无效');
    rows = rows.concat(response.data);
    cursor = response.meta.nextCursor;
    if (!cursor) return rows;
  }
  throw new Error('赛程分页超限，请联系主办方');
}
function clockText(snapshot, receivedAt, now = Date.now()) {
  if (!snapshot || !snapshot.clock) return '未准备';
  const c = snapshot.clock;
  let remaining = c.remainingMs;
  if (c.running)
    remaining -= Math.max(
      0,
      Date.parse(snapshot.serverTime) + (now - receivedAt) - Date.parse(c.anchorServerTime),
    );
  const seconds = Math.ceil(Math.max(0, remaining) / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function mediaUrl(path) {
  if (
    typeof path !== 'string' ||
    !/^\/v1\/public\/events\/[A-Za-z0-9_-]{43}\/matches\/[A-Za-z0-9_-]{43}\/media\/[A-Za-z0-9_-]{43}\/content$/.test(
      path,
    )
  )
    throw new Error('媒体地址无效');
  return API_ORIGIN + path;
}
function publicTime(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '时间待确认';
  const d = new Date(time + 8 * 3600000),
    pad = (v) => String(v).padStart(2, '0');
  return (
    pad(d.getUTCMonth() + 1) +
    '/' +
    pad(d.getUTCDate()) +
    ' ' +
    pad(d.getUTCHours()) +
    ':' +
    pad(d.getUTCMinutes())
  );
}
const eventStates = {
  DRAFT: '赛事筹备中',
  REGISTRATION_OPEN: '报名开放',
  REGISTRATION_CLOSED: '报名已关闭',
  SCHEDULED: '赛程已发布',
  RUNNING: '比赛进行中',
  COMPLETED: '本届已完赛',
  ARCHIVED: '历史赛事',
  CANCELLED: '赛事已取消',
};
const matchStates = {
  SCHEDULED: '待开始',
  READY: '赛前准备',
  LIVE: '比赛进行中',
  IN_PROGRESS: '比赛进行中',
  PAUSED: '暂停',
  FINISHED: '本场已结束',
  FINAL: '本场已结束',
  CANCELLED: '已取消',
  POSTPONED: '已延期',
};
module.exports = {
  API_ORIGIN,
  publicId,
  uuid,
  eventFromInput,
  pathAllowed,
  createClient,
  getClient,
  allSchedule,
  clockText,
  mediaUrl,
  publicTime,
  eventStatus: (value) => eventStates[value] || value || '状态待确认',
  matchStatus: (value) => matchStates[value] || value || '状态待确认',
  resultStatus: (value) =>
    ({
      UNCONFIRMED: '尚无正式赛果',
      CONFIRMED: '赛果已独立确认',
      REQUIRES_RECONFIRMATION: '更正后待重新确认',
    })[value] || '赛果待确认',
  eventFormat: (value) =>
    ({
      ROUND_ROBIN: '单循环赛事',
      DOUBLE_ROUND_ROBIN: '双循环赛事',
      SINGLE_ELIMINATION: '单淘汰赛事',
      GROUP_KNOCKOUT: '分组循环接淘汰',
    })[value] || '单循环赛事',
};
