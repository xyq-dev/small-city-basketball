import 'reflect-metadata';
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Inject,
  HttpCode,
  Module,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Response, NextFunction } from 'express';
import { ApiError, ApiExceptionFilter } from './errors.js';
import type { ApiRequest } from './errors.js';
import { ApplicationService } from './service.js';
import { RegistrationService } from './registration-service.js';
import { SchedulingService } from './scheduling-service.js';
import { SchedulingController } from './scheduling-controller.js';
import { ScoringService } from './scoring-service.js';
import { ScoringController, SCB_SCORING_SERVICE } from './scoring-controller.js';
import {
  RegistrationController,
  InvitationAcceptanceController,
} from './registration-controller.js';
import type { ApiOptions } from './service.js';
import { clearedSessionCookie, sessionCookie } from './security.js';
import { objectInput } from './validation.js';

const SERVICE = 'SCB_APPLICATION_SERVICE';
const SCHEDULING_SERVICE = 'SCB_SCHEDULING_SERVICE';
const envelope = <T>(request: ApiRequest, data: T, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: request.requestId, ...extra },
});
const peerIp = (request: ApiRequest) => request.ip || request.socket.remoteAddress || 'unknown';

@Controller('v1/auth')
class AuthController {
  constructor(@Inject(SERVICE) private readonly service: RegistrationService) {}

  @Post('register-participant')
  async registerParticipant(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.registerParticipant(body, peerIp(request));
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, this.service.sessionTtlSeconds, this.service.secureCookies),
    );
    return envelope(request, result.data);
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.register(body, peerIp(request));
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, this.service.sessionTtlSeconds, this.service.secureCookies),
    );
    return envelope(request, result.data);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.login(body, peerIp(request));
    response.setHeader(
      'Set-Cookie',
      sessionCookie(result.token, this.service.sessionTtlSeconds, this.service.secureCookies),
    );
    return envelope(request, result.data);
  }

  @Get('session')
  async session(@Req() request: ApiRequest) {
    return envelope(request, await this.service.session(request.headers.cookie));
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: ApiRequest, @Res({ passthrough: true }) response: Response) {
    if (request.body !== undefined) objectInput(request.body, []);
    await this.service.logout(request.headers.cookie);
    response.setHeader('Set-Cookie', clearedSessionCookie(this.service.secureCookies));
    return envelope(request, null);
  }
}

@Controller('v1/orgs/:orgId')
class OrganizationController {
  constructor(@Inject(SERVICE) private readonly service: ApplicationService) {}

  @Get('events')
  async list(@Param('orgId') orgId: string, @Query() query: unknown, @Req() request: ApiRequest) {
    const result = await this.service.listEvents(request.headers.cookie, orgId, query);
    return envelope(request, result.data, { nextCursor: result.nextCursor });
  }

  @Post('events')
  async create(@Param('orgId') orgId: string, @Body() body: unknown, @Req() request: ApiRequest) {
    return envelope(request, await this.service.createEvent(request.headers.cookie, orgId, body));
  }

  @Get('events/:eventId')
  async get(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Req() request: ApiRequest,
  ) {
    return envelope(request, await this.service.getEvent(request.headers.cookie, orgId, eventId));
  }

  @Patch('events/:eventId')
  async update(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return envelope(
      request,
      await this.service.updateEvent(request.headers.cookie, orgId, eventId, body),
    );
  }

  @Get('members')
  async members(@Param('orgId') orgId: string, @Req() request: ApiRequest) {
    return envelope(request, await this.service.listMembers(request.headers.cookie, orgId));
  }

  @Put('members/:userId')
  async member(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return envelope(
      request,
      await this.service.putMember(request.headers.cookie, orgId, userId, body),
    );
  }

  @Put('events/:eventId/staff/:userId')
  async staff(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return envelope(
      request,
      await this.service.putStaff(request.headers.cookie, orgId, eventId, userId, body),
    );
  }
}

@Controller()
class HealthController {
  constructor(@Inject(SERVICE) private readonly service: ApplicationService) {}
  @Get('health')
  async health(@Req() request: ApiRequest) {
    try {
      await this.service.pool.query('SELECT 1');
    } catch {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', '数据库暂不可用');
    }
    return envelope(request, { status: 'ok' });
  }
}

export async function createApi(
  options: ApiOptions,
): Promise<{ app: INestApplication; pool: Pool }> {
  if (!options.databaseUrl) throw new Error('databaseUrl is required');
  let origin: URL;
  try {
    origin = new URL(options.appOrigin);
  } catch {
    throw new Error('appOrigin must be an HTTP(S) origin');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== options.appOrigin)
    throw new Error('appOrigin must be an HTTP(S) origin without a path');
  if (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')
    throw new Error('Production appOrigin must use HTTPS');
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 12,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => console.error('Database idle connection error'));
  try {
    const service = new RegistrationService(pool, options);
    const scheduling = new SchedulingService(pool, options);
    const scoring = new ScoringService(pool, options);
    @Module({
      controllers: [
        AuthController,
        OrganizationController,
        HealthController,
        RegistrationController,
        InvitationAcceptanceController,
        SchedulingController,
        ScoringController,
      ],
      providers: [
        { provide: SERVICE, useValue: service },
        { provide: SCHEDULING_SERVICE, useValue: scheduling },
        { provide: SCB_SCORING_SERVICE, useValue: scoring },
      ],
    })
    class ApiModule {}
    const app = await NestFactory.create(ApiModule, { logger: false, bodyParser: true });
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    app.use((request: ApiRequest, response: Response, next: NextFunction) => {
      request.requestId = randomUUID();
      response.setHeader('X-Request-ID', request.requestId);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        request.headers.origin !== options.appOrigin
      ) {
        response.status(403).json({
          error: {
            code: 'ORIGIN_REJECTED',
            message: '请求来源不受支持',
            requestId: request.requestId,
          },
        });
        return;
      }
      next();
    });
    app.enableCors({
      origin: options.appOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    return { app, pool };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
