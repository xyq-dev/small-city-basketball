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
import { PlayerBookingService } from './player-booking/service.js';
import { PlayerPerformanceService } from './player-booking/performance-service.js';
import {
  PlayerPerformanceController,
  SCB_PLAYER_PERFORMANCE_SERVICE,
} from './player-booking/performance-controller.js';
import {
  PlayerBookingController,
  SCB_PLAYER_BOOKING_SERVICE,
} from './player-booking/controller.js';
import { WechatService } from './wechat-service.js';
import type { WechatServiceOptions } from './wechat-service.js';
import { WechatController, SCB_WECHAT_SERVICE } from './wechat-controller.js';
import { RegistrationService } from './registration-service.js';
import { SchedulingService } from './scheduling-service.js';
import { SchedulingController } from './scheduling-controller.js';
import { GroupKnockoutService } from './group-knockout-service.js';
import {
  GroupKnockoutController,
  SCB_GROUP_KNOCKOUT_SERVICE,
} from './group-knockout-controller.js';
import { MediaService } from './media-service.js';
import { MediaController, PublicMediaController, SCB_MEDIA_SERVICE } from './media-controller.js';
import { CommerceService } from './commerce/service.js';
import { WechatPayClient } from './commerce/wechatpay.js';
import {
  CommerceCapabilitiesController,
  OrgCommerceController,
  PlatformCommerceController,
  WechatPayNotificationController,
  SCB_COMMERCE_SERVICE,
} from './commerce/controller.js';
import { KnockoutController, SCB_KNOCKOUT_SERVICE } from './knockout-controller.js';
import { ScoringService } from './scoring-service.js';
import { ScoringController, SCB_SCORING_SERVICE } from './scoring-controller.js';
import { StandingsService } from './standings-service.js';
import { StandingsController, SCB_STANDINGS_SERVICE } from './standings-controller.js';
import { PublicViewingController } from './public-viewing-controller.js';
import { EventLifecycleService } from './event-lifecycle-service.js';
import {
  EventLifecycleController,
  SCB_EVENT_LIFECYCLE_SERVICE,
} from './event-lifecycle-controller.js';
import { EventPlayerStatisticsService } from './event-player-statistics-service.js';
import {
  EventPlayerStatisticsController,
  SCB_EVENT_PLAYER_STATISTICS_SERVICE,
} from './event-player-statistics-controller.js';
import { OverlayService } from './overlay-service.js';
import { OverlayController, SCB_OVERLAY_SERVICE } from './overlay-controller.js';
import { OverlaySourceController } from './overlay-bootstrap.js';
import {
  RegistrationController,
  InvitationAcceptanceController,
} from './registration-controller.js';
import type { ApiOptions } from './service.js';
import { clearedSessionCookie, sessionCookie } from './security.js';
import { objectInput } from './validation.js';
import { resolveApiOptions } from './runtime-config.js';
import { assertRuntimeReadiness } from './readiness.js';
import { isPaymentNotificationRequest, requestBodyMiddleware } from './request-body.js';

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

  @Get('capabilities')
  capabilities(@Req() request: ApiRequest) {
    return envelope(request, this.service.authCapabilities());
  }

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
  @Get('ready')
  async ready(@Req() request: ApiRequest) {
    await assertRuntimeReadiness(this.service.pool);
    return envelope(request, { status: 'ready' });
  }
}

export async function createApi(
  input: ApiOptions & {
    wechat?: WechatServiceOptions;
    media?: { trustedExternalHosts?: string[] };
    commercePayments?: WechatPayClient;
  },
): Promise<{ app: INestApplication; pool: Pool }> {
  const options = resolveApiOptions(input);
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 12,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => console.error('Database idle connection error'));
  try {
    if (options.production) await assertRuntimeReadiness(pool);
    const service = new RegistrationService(pool, options);
    const playerBooking = new PlayerBookingService(pool, options);
    const playerPerformance = new PlayerPerformanceService(pool, options);
    const scheduling = new SchedulingService(pool, options);
    const wechat = new WechatService(pool, options, input.wechat);
    const knockout = new GroupKnockoutService(pool, options);
    const media = new MediaService(
      pool,
      options,
      input.media ?? {
        trustedExternalHosts: (process.env.SCB_MEDIA_TRUSTED_HOSTS ?? '')
          .split(',')
          .filter(Boolean),
      },
    );
    const commerce = new CommerceService(pool, options, input.commercePayments);
    const scoring = new ScoringService(pool, options);
    const standings = new StandingsService(pool, options);
    const overlay = new OverlayService(pool, options);
    const lifecycle = new EventLifecycleService(pool, options);
    const playerStatistics = new EventPlayerStatisticsService(pool, options);
    @Module({
      controllers: [
        AuthController,
        PlayerBookingController,
        PlayerPerformanceController,
        WechatController,
        GroupKnockoutController,
        MediaController,
        PublicMediaController,
        CommerceCapabilitiesController,
        OrgCommerceController,
        PlatformCommerceController,
        WechatPayNotificationController,
        OrganizationController,
        HealthController,
        RegistrationController,
        InvitationAcceptanceController,
        SchedulingController,
        KnockoutController,
        ScoringController,
        StandingsController,
        PublicViewingController,
        EventLifecycleController,
        EventPlayerStatisticsController,
        OverlayController,
        OverlaySourceController,
      ],
      providers: [
        { provide: SERVICE, useValue: service },
        { provide: SCB_PLAYER_BOOKING_SERVICE, useValue: playerBooking },
        { provide: SCB_PLAYER_PERFORMANCE_SERVICE, useValue: playerPerformance },
        { provide: SCB_WECHAT_SERVICE, useValue: wechat },
        { provide: SCB_GROUP_KNOCKOUT_SERVICE, useValue: knockout },
        { provide: SCB_MEDIA_SERVICE, useValue: media },
        { provide: SCB_COMMERCE_SERVICE, useValue: commerce },
        { provide: SCHEDULING_SERVICE, useValue: scheduling },
        { provide: SCB_KNOCKOUT_SERVICE, useValue: knockout },
        { provide: SCB_SCORING_SERVICE, useValue: scoring },
        { provide: SCB_STANDINGS_SERVICE, useValue: standings },
        { provide: SCB_OVERLAY_SERVICE, useValue: overlay },
        { provide: SCB_EVENT_LIFECYCLE_SERVICE, useValue: lifecycle },
        { provide: SCB_EVENT_PLAYER_STATISTICS_SERVICE, useValue: playerStatistics },
      ],
    })
    class ApiModule {}
    const app = await NestFactory.create(ApiModule, { logger: false, bodyParser: false });
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    app.getHttpAdapter().getInstance().set('trust proxy', options.trustProxyHops);
    app.use((request: ApiRequest, response: Response, next: NextFunction) => {
      request.requestId = randomUUID();
      response.setHeader('X-Request-ID', request.requestId);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        !isPaymentNotificationRequest(request) &&
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
    app.use(requestBodyMiddleware());
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
