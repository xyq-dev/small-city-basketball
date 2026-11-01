import type {
  DispatchCapabilities,
  DispatchOfferData,
  DispatchRequestData,
  InsuranceWorkspaceData,
  PublicRegionCatalogData,
  TrainingCohortData,
} from '@small-city-basketball/contracts';
import { ApiError, type ApiClient } from './client';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const invalid = (label: string): never => {
  throw new ApiError(200, 'INVALID_RESPONSE', `${label}返回不完整，请刷新后重试`);
};

export interface DispatchPreference {
  enabled: boolean;
  regionIds: string[];
  version: number;
  dailyLimit: number;
}
export interface DispatchWorkspace {
  capabilities: DispatchCapabilities;
  requests: DispatchRequestData[];
  offers: DispatchOfferData[];
  truncated: boolean;
  preference: DispatchPreference | null;
}
export interface DispatchRequestDetail {
  request: DispatchRequestData;
  offers: DispatchOfferData[];
}
export interface TrainingWorkspace {
  provider: Obj | null;
  coaches: Obj[];
  courses: Obj[];
  courts: { id: string; name: string }[];
  cohorts: TrainingCohortData[];
  enrollments: Obj[];
  capabilities: {
    enabled: boolean;
    paidEnrollmentEnabled: boolean;
    adultOnly: boolean;
    youthEnrollmentEnabled: boolean;
    packagesEnabled: boolean;
  };
}
export interface TrainingRoster {
  session: Obj;
  learners: Obj[];
  consumptions: Obj[];
  canManage: boolean;
}
export interface SponsorList {
  enabled: boolean;
  canManage: boolean;
  canFinance: boolean;
  canAdvance: boolean;
  userId: string;
  campaignOptions: Obj[];
  contracts: Obj[];
  orders: Obj[];
  beneficiaries: Obj[];
  receiverOptions: {
    beneficiaryOrgId: string;
    displayName: string;
    authorizationVersion: string;
  }[];
}
export interface SponsorStatements {
  items: Obj[];
}
export interface SponsorInbox {
  organizations: { id: string; name: string; role: 'ADVERTISER' }[];
}

function record(v: unknown, label: string): Obj {
  if (!object(v)) return invalid(label);
  if (!str(v.id)) return invalid(label);
  return v;
}
function payload(v: unknown, label: string): Obj {
  if (!object(v)) return invalid(label);
  return v;
}
function list(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) return invalid(label);
  return v as unknown[];
}

function capabilities(v: unknown): DispatchCapabilities {
  if (
    !object(v) ||
    typeof v.enabled !== 'boolean' ||
    typeof v.conversionEnabled !== 'boolean' ||
    v.externalNotifications !== false
  )
    invalid('跨城调度');
  return v as unknown as DispatchCapabilities;
}

function requestRow(v: unknown): DispatchRequestData {
  const row = record(v, '跨城需求');
  if (!str(row.orgId) || !str(row.status) || !Number.isSafeInteger(row.version))
    invalid('跨城需求');
  return row as unknown as DispatchRequestData;
}

function offerRow(v: unknown): DispatchOfferData {
  const row = record(v, '跨城邀请');
  if (!str(row.status) || !Number.isSafeInteger(row.version) || !object(row.request))
    invalid('跨城邀请');
  return row as unknown as DispatchOfferData;
}

export function createOperationsApi(client: ApiClient) {
  return {
    async dispatchWorkspace() {
      const data = payload((await client.request<unknown>('/v1/dispatch')).data, '跨城调度');
      const requests = list(data.requests, '跨城调度');
      const offers = list(data.offers, '跨城调度');
      return {
        capabilities: capabilities(data.capabilities),
        requests: requests.map(requestRow),
        offers: offers.map(offerRow),
        truncated: data.truncated === true,
        preference:
          data.preference === null
            ? null
            : object(data.preference) &&
                typeof data.preference.enabled === 'boolean' &&
                Array.isArray(data.preference.regionIds) &&
                Number.isSafeInteger(data.preference.version) &&
                Number.isSafeInteger(data.preference.dailyLimit)
              ? (data.preference as unknown as DispatchPreference)
              : invalid('跨城调度'),
      } satisfies DispatchWorkspace;
    },
    async dispatchRequest(id: string) {
      const data = payload(
        (await client.request<unknown>(`/v1/dispatch/requests/${encodeURIComponent(id)}`)).data,
        '跨城需求',
      );
      return {
        request: requestRow(data.request),
        offers: list(data.offers, '跨城需求').map(offerRow),
      };
    },
    async dispatchOffer(id: string) {
      const { data } = await client.request<unknown>(
        `/v1/dispatch/offers/${encodeURIComponent(id)}`,
      );
      return offerRow(data);
    },
    async regions() {
      const { data } = await client.request<PublicRegionCatalogData>('/v1/public/regions');
      if (!object(data) || !str(data.catalogVersion) || !Array.isArray(data.regions))
        invalid('地区目录');
      return data;
    },
    async listingSlots(listingId: string) {
      const { data } = await client.request<unknown>(
        `/v1/public/local-listings/${encodeURIComponent(listingId)}`,
      );
      const body = payload(data, '服务档期');
      return list(body.slots, '服务档期')
        .filter(
          (slot): slot is Obj & { id: string; available: boolean } =>
            object(slot) && str(slot.id) && typeof slot.available === 'boolean',
        )
        .map((slot) => ({
          id: slot.id,
          startsAt: typeof slot.startsAt === 'string' ? slot.startsAt : undefined,
          endsAt: typeof slot.endsAt === 'string' ? slot.endsAt : undefined,
          available: slot.available === true,
        }));
    },
    post(path: string, body: Obj) {
      return client.request<unknown>(path, { method: 'POST', body: JSON.stringify(body) });
    },
    async trainingWorkspace(orgId: string) {
      const { data } = await client.request<unknown>(
        `/v1/orgs/${encodeURIComponent(orgId)}/training`,
      );
      if (
        !object(data) ||
        !object(data.capabilities) ||
        data.capabilities.adultOnly !== true ||
        typeof data.capabilities.enabled !== 'boolean' ||
        typeof data.capabilities.youthEnrollmentEnabled !== 'boolean' ||
        !Array.isArray(data.cohorts) ||
        !Array.isArray(data.courses) ||
        !Array.isArray(data.coaches) ||
        !Array.isArray(data.courts) ||
        !Array.isArray(data.enrollments) ||
        (data.provider !== null && !object(data.provider))
      )
        invalid('培训');
      return data as unknown as TrainingWorkspace;
    },
    async trainingEnrollment(id: string) {
      const data = payload(
        (await client.request<unknown>(`/v1/training/enrollments/${encodeURIComponent(id)}`)).data,
        '报名',
      );
      if (!str(data.id) || !Array.isArray(data.refunds)) return invalid('报名');
      return data;
    },
    async trainingRoster(sessionId: string) {
      const { data } = await client.request<unknown>(
        `/v1/training/sessions/${encodeURIComponent(sessionId)}/roster`,
      );
      const body = payload(data, '课次名单');
      if (!object(body.session)) return invalid('课次名单');
      return {
        session: body.session,
        learners: list(body.learners, '课次名单').filter(object),
        consumptions: Array.isArray(body.consumptions) ? body.consumptions.filter(object) : [],
        canManage: body.canManage === true,
      } satisfies TrainingRoster;
    },
    async insuranceWorkspace() {
      const { data } = await client.request<InsuranceWorkspaceData>('/v1/insurance');
      if (
        !object(data) ||
        typeof data.enabled !== 'boolean' ||
        typeof data.maintenanceEnabled !== 'boolean' ||
        !Array.isArray(data.orders) ||
        typeof data.notice !== 'string'
      )
        invalid('保险');
      return data;
    },
    async sponsorInbox() {
      const { data } = await client.request<SponsorInbox>('/v1/me/sponsor-commerce');
      if (!object(data) || !Array.isArray(data.organizations)) invalid('广告合同');
      return data;
    },
    async sponsorList(orgId: string) {
      const { data } = await client.request<unknown>(
        `/v1/orgs/${encodeURIComponent(orgId)}/sponsor-commerce`,
      );
      if (
        !object(data) ||
        typeof data.enabled !== 'boolean' ||
        typeof data.canManage !== 'boolean' ||
        typeof data.canFinance !== 'boolean' ||
        !str(data.userId) ||
        !Array.isArray(data.contracts) ||
        !Array.isArray(data.orders)
      )
        invalid('广告合同');
      return data as unknown as SponsorList;
    },
    async sponsorOrder(orgId: string, id: string) {
      const { data } = await client.request<unknown>(
        `/v1/orgs/${encodeURIComponent(orgId)}/sponsor-commerce/orders/${encodeURIComponent(id)}`,
      );
      const body = payload(data, '广告订单');
      if (!object(body.order) || !str(body.order.id)) invalid('广告订单');
      return body;
    },
    async sponsorStatements(orgId: string) {
      const { data } = await client.request<unknown>(
        `/v1/orgs/${encodeURIComponent(orgId)}/sponsor-commerce/statements`,
      );
      const body = payload(data, '广告收益');
      return { items: list(body.items, '广告收益').filter(object) } satisfies SponsorStatements;
    },
  };
}
