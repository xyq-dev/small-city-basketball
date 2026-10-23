import { Catch, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ApiRequest extends Request {
  requestId: string;
  /** Exact bounded webhook bytes; never reconstructed from parsed JSON. */
  rawBody?: Buffer;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', '请先登录后再操作');
export const notFound = () => new ApiError(404, 'RESOURCE_NOT_FOUND', '未找到可访问的资源');
export const forbidden = () => new ApiError(403, 'FORBIDDEN', '没有执行此操作的权限');

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<ApiRequest>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务暂时无法完成操作，请稍后重试';
    let details: Record<string, unknown> | undefined;
    if (error instanceof ApiError) {
      ({ status, code, message, details } = error);
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      if (status === 404) {
        code = 'RESOURCE_NOT_FOUND';
        message = '未找到可访问的资源';
      } else if (status === 400 || status === 413 || status === 415) {
        code = 'VALIDATION_ERROR';
        message = '请求内容不符合接口要求';
      }
    } else if (error instanceof Error) {
      const parserError = error as Error & {
        status?: unknown;
        statusCode?: unknown;
        type?: unknown;
      };
      const parserStatus = parserError.status ?? parserError.statusCode;
      if (
        typeof parserError.type === 'string' &&
        [
          'entity.parse.failed',
          'entity.too.large',
          'request.aborted',
          'request.size.invalid',
          'encoding.unsupported',
          'charset.unsupported',
        ].includes(parserError.type) &&
        (parserStatus === 400 || parserStatus === 413 || parserStatus === 415)
      ) {
        status = parserStatus;
        code = 'VALIDATION_ERROR';
        message = '请求内容不符合接口要求';
      }
    }
    if (status === 429 && typeof details?.retryAfter === 'number') {
      response.setHeader('Retry-After', String(details.retryAfter));
    }
    const requestId = request.requestId || randomUUID();
    response.setHeader('X-Request-ID', requestId);
    response.status(status).json({
      error: { code, message, requestId, ...(details ? { details } : {}) },
    });
  }
}
