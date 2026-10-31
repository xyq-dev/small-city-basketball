import { describe, expect, test, vi } from 'vitest';
import type { ApiRequest } from './errors.js';
import type { RecruitmentService } from './recruitment-service.js';
import { RecruitmentController } from './recruitment-controller.js';
const request = {
  headers: { cookie: 'scb.session=private' },
  ip: '127.0.0.1',
  socket: { remoteAddress: '127.0.0.1' },
  requestId: 'test-request',
} as ApiRequest;

describe('X05 controller boundary', () => {
  test('anonymous recruitment read never forwards the private session cookie', async () => {
    const publicView = vi.fn().mockResolvedValue({ title: '公开招募' });
    const c = new RecruitmentController({ publicView } as unknown as RecruitmentService);
    expect(await c.publicView(request, 'public-id')).toEqual({
      data: { title: '公开招募' },
      meta: { requestId: 'test-request' },
    });
    expect(publicView).toHaveBeenCalledWith('public-id', '127.0.0.1');
  });
  test('applying and management pass the current session and do not infer identity from body', async () => {
    const apply = vi.fn().mockResolvedValue({ application: {} }),
      workspace = vi.fn().mockResolvedValue({});
    const c = new RecruitmentController({ apply, workspace } as unknown as RecruitmentService);
    const body = { clientRequestId: 'original-request', teamName: '申请队' };
    await c.apply(request, 'public-id', body);
    await c.workspace(request, 'org', 'event');
    expect(apply).toHaveBeenCalledWith('scb.session=private', 'public-id', body, '127.0.0.1');
    expect(workspace).toHaveBeenCalledWith('scb.session=private', 'org', 'event');
  });
});
