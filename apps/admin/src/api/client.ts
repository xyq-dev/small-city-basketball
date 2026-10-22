import type { ApiEnvelope, SessionData } from '@small-city-basketball/contracts';
import { AppError } from '../domain/repository';
import type { CreateEventInput, EventFieldErrors } from '../domain/types';
import type { TeamContext } from '../registration/shared';

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: unknown): EventFieldErrors | undefined {
  if (!object(value)) return undefined;
  const result: EventFieldErrors = {};
  const allowed: (keyof CreateEventInput)[] = [
    'name',
    'startDate',
    'endDate',
    'timezone',
    'venueName',
    'format',
  ];
  for (const key of allowed) if (typeof value[key] === 'string') result[key] = value[key];
  return Object.keys(result).length ? result : undefined;
}

export class ApiError extends AppError {
  readonly status: number;
  readonly apiCode: string;
  readonly details?: JsonObject;

  constructor(status: number, code: string, message: string, details?: JsonObject) {
    const mapped =
      code === 'NOT_FOUND' || status === 404
        ? 'NOT_FOUND'
        : code === 'VERSION_CONFLICT' || status === 409
          ? 'VERSION_CONFLICT'
          : code === 'INVALID_EVENT_STATE' || status === 403
            ? 'INVALID_EVENT_STATE'
            : 'VALIDATION_ERROR';
    super(mapped, message, fields(details?.fieldErrors));
    this.name = 'ApiError';
    this.status = status;
    this.apiCode = code;
    this.details = details;
  }
}

export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>>;
}

export function createApiClient({
  fetcher,
  onUnauthorized,
}: { fetcher?: Fetcher; onUnauthorized?: () => void } = {}): ApiClient {
  return {
    async request<T>(path: string, init: RequestInit = {}) {
      if (!path.startsWith('/v1/') || path.startsWith('//'))
        throw new ApiError(0, 'INVALID_API_PATH', '仅允许连接本地同源 API');
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      let response: Response;
      try {
        response = await (fetcher ?? globalThis.fetch)(path, {
          ...init,
          headers,
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', '无法连接业务服务，请确认 API 已启动后重试');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (!response.ok) {
        if (response.status === 401) onUnauthorized?.();
        const error = object(payload) && object(payload.error) ? payload.error : {};
        const code = typeof error.code === 'string' ? error.code : `HTTP_${response.status}`;
        const message =
          typeof error.message === 'string' && error.message
            ? error.message
            : response.status === 401
              ? '登录已失效，请重新登录'
              : response.status === 403
                ? '当前身份没有执行此操作的权限'
                : '业务服务暂时无法完成请求，请重试';
        throw new ApiError(
          response.status,
          code,
          message,
          object(error.details) ? error.details : undefined,
        );
      }
      if (
        !object(payload) ||
        !Object.hasOwn(payload, 'data') ||
        !object(payload.meta) ||
        typeof payload.meta.requestId !== 'string'
      ) {
        throw new ApiError(response.status, 'INVALID_RESPONSE', '服务返回格式不正确，请重试');
      }
      return payload as unknown as ApiEnvelope<T>;
    },
  };
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}
export type AuthSession = Omit<SessionData, 'teamContexts'> & { teamContexts: TeamContext[] };
export interface AuthApi {
  session(): Promise<AuthSession>;
  login(email: string, password: string): Promise<AuthSession>;
  register(input: RegisterInput): Promise<AuthSession>;
  registerParticipant(input: Omit<RegisterInput, 'organizationName'>): Promise<AuthSession>;
  logout(): Promise<void>;
}

function sessionData(value: unknown): AuthSession {
  if (
    !object(value) ||
    !object(value.user) ||
    typeof value.user.id !== 'string' ||
    typeof value.user.email !== 'string' ||
    typeof value.user.displayName !== 'string' ||
    !Array.isArray(value.organizations)
  )
    throw new ApiError(200, 'INVALID_SESSION', '服务返回的登录资料不完整');
  const roles = new Set([
    'ORG_OWNER',
    'ORG_ADMIN',
    'EVENT_MANAGER',
    'REVIEWER',
    'SCORER',
    'STREAMER',
  ]);
  for (const org of value.organizations)
    if (
      !object(org) ||
      typeof org.id !== 'string' ||
      typeof org.name !== 'string' ||
      typeof org.role !== 'string' ||
      !roles.has(org.role)
    )
      throw new ApiError(200, 'INVALID_SESSION', '服务返回的机构资料不完整');
  if (value.teamContexts !== undefined) {
    if (!Array.isArray(value.teamContexts))
      throw new ApiError(200, 'INVALID_SESSION', '服务返回的球队授权资料不完整');
    for (const team of value.teamContexts)
      if (
        !object(team) ||
        typeof team.orgId !== 'string' ||
        typeof team.organizationName !== 'string' ||
        typeof team.teamId !== 'string' ||
        typeof team.teamName !== 'string'
      )
        throw new ApiError(200, 'INVALID_SESSION', '服务返回的球队授权资料不完整');
  }
  return { ...value, teamContexts: value.teamContexts ?? [] } as unknown as AuthSession;
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    async session() {
      return sessionData((await client.request<unknown>('/v1/auth/session')).data);
    },
    async login(email, password) {
      return sessionData(
        (
          await client.request<unknown>('/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          })
        ).data,
      );
    },
    async register(input) {
      return sessionData(
        (
          await client.request<unknown>('/v1/auth/register', {
            method: 'POST',
            body: JSON.stringify(input),
          })
        ).data,
      );
    },
    async registerParticipant(input) {
      return sessionData(
        (
          await client.request<unknown>('/v1/auth/register-participant', {
            method: 'POST',
            body: JSON.stringify(input),
          })
        ).data,
      );
    },
    async logout() {
      await client.request<null>('/v1/auth/logout', { method: 'POST' });
    },
  };
}
