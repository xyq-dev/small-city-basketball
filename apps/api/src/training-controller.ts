import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { TrainingService } from './training-service.js';
export const SCB_TRAINING_SERVICE = 'SCB_TRAINING_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
@Controller('v1/training')
export class TrainingController {
  constructor(@Inject(SCB_TRAINING_SERVICE) private readonly service: TrainingService) {}
  @Get('catalog') async catalog(@Req() r: ApiRequest) {
    return envelope(r, await this.service.catalog());
  }
  @Get('cohorts/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.detail(id));
  }
  @Post('cohorts/:id/enrollments') @HttpCode(200) async enroll(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.enroll(r.headers.cookie, id, v));
  }
  @Post('cohorts/:id/commands') @HttpCode(200) async cohortCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.cohortCommand(r.headers.cookie, id, v));
  }
  @Get('mine') async mine(@Req() r: ApiRequest) {
    return envelope(r, await this.service.myEnrollments(r.headers.cookie));
  }
  @Get('enrollments/:id') async enrollment(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.enrollmentDetail(r.headers.cookie, id));
  }
  @Post('enrollments/:id/commands') @HttpCode(200) async enrollmentCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.enrollmentCommand(r.headers.cookie, id, v));
  }
  @Post('enrollments/:id/refunds') @HttpCode(200) async requestRefund(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.requestRefund(r.headers.cookie, id, v));
  }
  @Post('entitlements/:id/commands') @HttpCode(200) async entitlementCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.entitlementCommand(r.headers.cookie, id, v));
  }
  @Get('sessions/:id/roster') async roster(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.sessionRoster(r.headers.cookie, id));
  }
  @Post('sessions/:id/commands') @HttpCode(200) async sessionCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.sessionCommand(r.headers.cookie, id, v));
  }
  @Post('consumptions/:id/commands') @HttpCode(200) async consumptionCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.consumptionCommand(r.headers.cookie, id, v));
  }
  @Post('refunds/:id/commands') @HttpCode(200) async refundCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.refundCommand(r.headers.cookie, id, v));
  }
  @Post('coaches/:id/commands') @HttpCode(200) async coachCommand(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.coachCommand(r.headers.cookie, id, v));
  }
  @Get('receipts/:id') async receipt(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.commandReceipt(r.headers.cookie, id));
  }
}
@Controller('v1/orgs/:orgId/training')
export class OrgTrainingController {
  constructor(@Inject(SCB_TRAINING_SERVICE) private readonly service: TrainingService) {}
  @Get() async workspace(@Req() r: ApiRequest, @Param('orgId') id: string) {
    return envelope(r, await this.service.workspace(r.headers.cookie, id));
  }
  @Post('provider') @HttpCode(200) async provider(
    @Req() r: ApiRequest,
    @Param('orgId') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.registerProvider(r.headers.cookie, id, v));
  }
  @Post('provider/commands') @HttpCode(200) async providerCommand(
    @Req() r: ApiRequest,
    @Param('orgId') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.providerCommand(r.headers.cookie, id, v));
  }
  @Post('coaches') @HttpCode(200) async coach(
    @Req() r: ApiRequest,
    @Param('orgId') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.addCoach(r.headers.cookie, id, v));
  }
  @Post('courses') @HttpCode(200) async course(
    @Req() r: ApiRequest,
    @Param('orgId') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.createCourse(r.headers.cookie, id, v));
  }
  @Post('cohorts') @HttpCode(200) async cohort(
    @Req() r: ApiRequest,
    @Param('orgId') id: string,
    @Body() v: unknown,
  ) {
    return envelope(r, await this.service.createCohort(r.headers.cookie, id, v));
  }
}
