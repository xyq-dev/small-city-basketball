import { json } from 'express';
import type { RequestHandler } from 'express';
import type { ApiRequest } from './errors.js';

export const WECHAT_PAYMENT_NOTIFICATION_PATH = '/v1/payments/wechat/notifications';
const uploadPath = /^\/v1\/orgs\/[0-9a-f-]{36}\/(?:entries|matches)\/[0-9a-f-]{36}\/media-files$/i;
export function isPaymentNotificationRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return request.method === 'POST' && request.path === WECHAT_PAYMENT_NOTIFICATION_PATH;
}
export function isMediaUploadRequest(request: Pick<ApiRequest, 'method' | 'path'>) {
  return request.method === 'POST' && uploadPath.test(request.path);
}

/** Apply the larger limit only after the exact upload route claims a bounded slot. */
export function requestBodyMiddleware(): RequestHandler {
  let activeUploads = 0;
  const ordinary = json({ limit: '100kb', inflate: false });
  const upload = json({ limit: '12mb', inflate: false });
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
    if (!isMediaUploadRequest(request)) return ordinary(request, response, next);
    if (activeUploads >= 2) {
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
    activeUploads++;
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
        activeUploads--;
        clearTimeout(timer);
      }
    };
    response.once('finish', release);
    response.once('close', release);
    request.once('aborted', release);
    upload(request, response, (error) => {
      clearTimeout(timer);
      next(error);
    });
  };
}
