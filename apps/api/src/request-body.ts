import { json } from 'express';
import type { RequestHandler } from 'express';
import type { ApiRequest } from './errors.js';

export const WECHAT_PAYMENT_NOTIFICATION_PATH = '/v1/payments/wechat/notifications';
const tradeNotificationPath = /^\/v1\/trade-notifications\/[A-Za-z0-9_-]{1,60}$/;
const uploadPath = /^\/v1\/orgs\/[0-9a-f-]{36}\/(?:entries|matches)\/[0-9a-f-]{36}\/media-files$/i;
// C19: the idempotent whole-file upload shares the original upload lane and limit.
const requestUploadPath =
  /^\/v1\/orgs\/[0-9a-f-]{36}\/matches\/[0-9a-f-]{36}\/media-file-requests$/i;
// C23: only the exact private draft PUT accepts one bounded image/document patch.
const participantDraftPath =
  /^\/v1\/orgs\/[0-9a-f-]{36}\/entries\/[0-9a-f-]{36}\/participant-materials\/mine$/i;
// C19: one 512 KiB chunk (base64 plus small JSON fields) fits well inside 1 MB.
const chunkPath =
  /^\/v1\/orgs\/[0-9a-f-]{36}\/matches\/[0-9a-f-]{36}\/media-upload-sessions\/[0-9a-f-]{36}\/chunks\/\d{1,2}$/i;
export function isPaymentNotificationRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return (
    request.method === 'POST' &&
    (request.path === WECHAT_PAYMENT_NOTIFICATION_PATH || tradeNotificationPath.test(request.path))
  );
}
export function isMediaUploadRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return (
    (request.method === 'POST' &&
      (uploadPath.test(request.path) || requestUploadPath.test(request.path))) ||
    (request.method === 'PUT' && participantDraftPath.test(request.path))
  );
}
export function isMediaChunkRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return request.method === 'PUT' && chunkPath.test(request.path);
}

export function isGovernanceAttachmentRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return (
    request.method === 'PUT' &&
    /^\/v1\/me\/governance\/cases\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i.test(request.path)
  );
}

type Lane = { active: number; max: number; parser: RequestHandler };

/** Apply a larger limit only after the exact upload route claims a bounded slot. */
export function requestBodyMiddleware(): RequestHandler {
  const ordinary = json({ limit: '100kb', inflate: false });
  const upload: Lane = { active: 0, max: 2, parser: json({ limit: '12mb', inflate: false }) };
  const governance: Lane = { active: 0, max: 2, parser: json({ limit: '6mb', inflate: false }) };
  const chunk: Lane = { active: 0, max: 8, parser: json({ limit: '1mb', inflate: false }) };
  const notification = json({
    limit: '100kb',
    inflate: false,
    verify(request, _response, buffer) {
      (request as ApiRequest).rawBody = Buffer.from(buffer);
    },
  });
  return (incoming, response, next) => {
    const request = incoming as ApiRequest;
    if (isPaymentNotificationRequest(request)) return notification(request, response, next);
    const lane = isGovernanceAttachmentRequest(request)
      ? governance
      : isMediaUploadRequest(request)
        ? upload
        : isMediaChunkRequest(request)
          ? chunk
          : null;
    if (!lane) return ordinary(request, response, next);
    if (lane.active >= lane.max) {
      response.setHeader('Retry-After', '1');
      response.status(429).json({
        error: {
          code: 'UPLOAD_BUSY',
          message: '当前上传繁忙，请稍后重试',
          requestId: request.requestId,
        },
      });
      request.resume();
      return;
    }
    lane.active++;
    const timer = setTimeout(() => {
      if (!response.headersSent)
        response.status(408).json({
          error: {
            code: 'UPLOAD_TIMEOUT',
            message: '上传读取超时，请重试',
            requestId: request.requestId,
          },
        });
      request.destroy();
    }, 30_000);
    timer.unref();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        lane.active--;
        clearTimeout(timer);
      }
    };
    response.once('finish', release);
    response.once('close', release);
    request.once('aborted', release);
    lane.parser(request, response, (error) => {
      clearTimeout(timer);
      next(error);
    });
  };
}
