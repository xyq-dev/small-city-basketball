import { isIP } from 'node:net';
import { insuranceDate, insuranceFail, insuranceHash, insuranceText } from './insurance-domain.js';
import type { InsuranceProvider } from './insurance-provider.js';

/** Reviewed deployment evidence, never accepted from an applicant or provider callback. */
export interface InsuranceAdmission {
  id: string;
  providerId: string;
  protocolVersion: string;
  evidenceHash: string;
  validFrom: string;
  validUntil: string;
  salesMode: 'APPROVED_API' | 'PROVIDER_HOSTED';
  allowedOrigins: string[];
  providerEntryUrl?: string;
  products: Array<{
    sourceHash: string;
    minAge: number;
    maxAge: number;
    timezone: string;
    /** Exact calendar-day coverage reviewed against the supplier contract. */
    coverageTimeBasis: 'EVENT_LOCAL_CALENDAR_DAYS';
    events: Array<{ orgId: string; eventId: string; eventHash: string }>;
  }>;
}
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = (): never => {
  throw Error('Invalid reviewed insurance admission configuration');
};
/** Canonical public HTTPS origin. The concrete driver must additionally pin DNS, disable redirects and bound I/O. */
export function insuranceProviderOrigin(value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return invalid();
  }
  const host = u.hostname.toLowerCase();
  if (
    u.origin !== value ||
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
    !host.includes('.') ||
    host.split('.').some((p) => !p || p.startsWith('-') || p.endsWith('-')) ||
    /(^|\.)(localhost|local|internal|test|example)$/.test(host)
  )
    return invalid();
  return u.origin;
}
export function normalizeInsuranceAdmission(
  raw: InsuranceAdmission,
  provider: Pick<InsuranceProvider, 'id' | 'allowedOrigins'>,
): Readonly<InsuranceAdmission> {
  const keys = (o: object, allowed: string[]) => {
    if (!o || typeof o !== 'object' || Object.keys(o).some((k) => !allowed.includes(k))) invalid();
  };
  keys(raw, [
    'id',
    'providerId',
    'protocolVersion',
    'evidenceHash',
    'validFrom',
    'validUntil',
    'salesMode',
    'allowedOrigins',
    'providerEntryUrl',
    'products',
  ]);
  const value = structuredClone(raw);
  if (
    !uuidPattern.test(value.id) ||
    value.providerId !== provider.id ||
    !hashPattern.test(value.evidenceHash)
  )
    invalid();
  insuranceText(value.providerId, 80);
  insuranceText(value.protocolVersion, 120);
  const from = Date.parse(value.validFrom),
    until = Date.parse(value.validUntil);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    from >= until ||
    !['APPROVED_API', 'PROVIDER_HOSTED'].includes(value.salesMode) ||
    !Array.isArray(value.allowedOrigins) ||
    value.allowedOrigins.length < 1 ||
    value.allowedOrigins.length > 10 ||
    !Array.isArray(value.products) ||
    value.products.length > 50
  )
    invalid();
  value.validFrom = new Date(from).toISOString();
  value.validUntil = new Date(until).toISOString();
  value.allowedOrigins = [...new Set(value.allowedOrigins.map(insuranceProviderOrigin))].sort();
  if (
    provider.allowedOrigins.length !== value.allowedOrigins.length ||
    provider.allowedOrigins.some((o) => !value.allowedOrigins.includes(insuranceProviderOrigin(o)))
  )
    invalid();
  if (value.providerEntryUrl) {
    const url = new URL(value.providerEntryUrl);
    if (!value.allowedOrigins.includes(url.origin) || url.username || url.password || url.hash)
      invalid();
  }
  if (value.salesMode === 'PROVIDER_HOSTED' && !value.providerEntryUrl) invalid();
  const products = new Set<string>();
  for (const p of value.products) {
    keys(p, ['sourceHash', 'minAge', 'maxAge', 'timezone', 'coverageTimeBasis', 'events']);
    if (
      !hashPattern.test(p.sourceHash) ||
      products.has(p.sourceHash) ||
      !Number.isInteger(p.minAge) ||
      !Number.isInteger(p.maxAge) ||
      p.minAge < 18 ||
      p.maxAge < p.minAge ||
      p.maxAge > 120 ||
      p.coverageTimeBasis !== 'EVENT_LOCAL_CALENDAR_DAYS' ||
      !Array.isArray(p.events) ||
      p.events.length < 1 ||
      p.events.length > 1000
    )
      invalid();
    products.add(p.sourceHash);
    try {
      new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format();
    } catch {
      invalid();
    }
    const events = new Set<string>();
    for (const e of p.events) {
      keys(e, ['orgId', 'eventId', 'eventHash']);
      const key = `${e.orgId}:${e.eventId}`;
      if (
        !uuidPattern.test(e.orgId) ||
        !uuidPattern.test(e.eventId) ||
        !hashPattern.test(e.eventHash) ||
        events.has(key)
      )
        invalid();
      events.add(key);
    }
  }
  // The retained object has no shared references to mutable caller configuration.
  return value;
}
export function insuranceEventHash(event: {
  orgId: string;
  eventId: string;
  startDate: string;
  endDate: string;
  timezone: string;
  venueName: string | null;
}): string {
  return insuranceHash([
    event.orgId,
    event.eventId,
    event.startDate,
    event.endDate,
    event.timezone,
    event.venueName,
  ]);
}
export function insuranceAdmissionActive(
  admission: Readonly<InsuranceAdmission> | undefined,
  now = Date.now(),
): boolean {
  return Boolean(
    admission && Date.parse(admission.validFrom) <= now && now < Date.parse(admission.validUntil),
  );
}
export function assertInsuranceAdmission(
  admission: Readonly<InsuranceAdmission> | undefined,
  input: {
    providerId: string;
    productHash: string;
    orgId: string;
    eventId: string;
    startDate: string;
    endDate: string;
    timezone: string;
    venueName: string | null;
    birthDate: string;
    releaseId?: string | null;
    now?: number;
  },
): void {
  if (
    !insuranceAdmissionActive(admission, input.now) ||
    admission!.providerId !== input.providerId ||
    admission!.salesMode !== 'APPROVED_API' ||
    (input.releaseId !== undefined && input.releaseId !== admission!.id)
  )
    insuranceFail(
      'INSURANCE_ADMISSION_REQUIRED',
      '在线投保准入尚未配置、已到期或版本已改变，请使用外部保单审核',
      409,
    );
  const product = admission!.products.find((p) => p.sourceHash === input.productHash);
  const eventHash = insuranceEventHash(input);
  if (
    !product ||
    product.timezone !== input.timezone ||
    !product.events.some(
      (e) => e.orgId === input.orgId && e.eventId === input.eventId && e.eventHash === eventHash,
    )
  )
    insuranceFail(
      'INSURANCE_SCOPE_NOT_APPROVED',
      '当前产品、组织或赛期场地不在已审核保障范围，请使用外部保单审核',
      409,
    );
  const birth = insuranceDate(input.birthDate),
    start = insuranceDate(input.startDate),
    end = insuranceDate(input.endDate);
  const ageAt = (date: string) =>
    Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) - Number(date.slice(5) < birth.slice(5));
  if (start > end || ageAt(start) < product!.minAge || ageAt(end) > product!.maxAge)
    insuranceFail(
      'INSURANCE_AGE_NOT_APPROVED',
      '当前年龄不符合已审核投保范围，请使用外部保单审核',
      409,
    );
}
