import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ApiRequest } from './errors.js';
import { LocalServicesService } from './local-services-service.js';
import { objectInput } from './validation.js';
export const SCB_LOCAL_SERVICES_SERVICE = 'SCB_LOCAL_SERVICES_SERVICE';
const envelope = <T>(r: ApiRequest, data: T) => ({ data, meta: { requestId: r.requestId } });
const ip = (r: ApiRequest) => r.ip || r.socket.remoteAddress || 'unknown';

@Controller('v1/public')
export class PublicLocalServicesController {
  constructor(@Inject(SCB_LOCAL_SERVICES_SERVICE) private readonly service: LocalServicesService) {}
  @Get('local-listings') async list(@Req() r: ApiRequest, @Query() raw: unknown) {
    const query = objectInput(raw, ['regionId', 'catalogVersion', 'kind', 'q', 'limit', 'cursor']);
    return envelope(r, await this.service.publicList(query, ip(r)));
  }
  @Post('local-search') @HttpCode(200) async nearby(@Req() r: ApiRequest, @Body() raw: unknown) {
    // Precise query coordinates stay out of URLs, shared caches and permanent records.
    return envelope(r, await this.service.publicList(raw, ip(r)));
  }
  @Get('local-listings/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.publicDetail(id, ip(r)));
  }
  @Post('local-location') @HttpCode(200) async location(
    @Req() r: ApiRequest,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.location(raw, ip(r)));
  }
}
@Controller('v1/orgs/:orgId/local-services')
export class OrgLocalServicesController {
  constructor(@Inject(SCB_LOCAL_SERVICES_SERVICE) private readonly service: LocalServicesService) {}
  @Get() async workspace(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.service.workspace(r.headers.cookie, org));
  }
  @Get('options') async options(@Req() r: ApiRequest, @Param('orgId') org: string) {
    return envelope(r, await this.service.supplyOptions(r.headers.cookie, org));
  }
  @Post('listings') @HttpCode(200) async create(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.createListing(r.headers.cookie, org, raw));
  }
  @Get('listings/:id') async detail(
    @Req() r: ApiRequest,
    @Param('orgId') org: string,
    @Param('id') id: string,
  ) {
    return envelope(r, await this.service.privateListing(r.headers.cookie, id, org));
  }
}
@Controller('v1/local-services')
export class PersonalLocalServicesController {
  constructor(@Inject(SCB_LOCAL_SERVICES_SERVICE) private readonly service: LocalServicesService) {}
  @Get('mine') async mine(@Req() r: ApiRequest) {
    return envelope(r, await this.service.workspace(r.headers.cookie));
  }
  @Get('receipts/:commandId') async receipt(@Req() r: ApiRequest, @Param('commandId') id: string) {
    return envelope(r, await this.service.receipt(r.headers.cookie, id));
  }
  @Get('listings/:id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.privateListing(r.headers.cookie, id));
  }
  @Put('listings/:id') async revise(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.reviseListing(r.headers.cookie, id, raw));
  }
  @Post('listings/:id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.listingCommand(r.headers.cookie, id, raw));
  }
  @Post('listings/:id/slots') @HttpCode(200) async slot(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.createSlot(r.headers.cookie, id, raw));
  }
  @Post('listings/:id/slots/:slotId/close') @HttpCode(200) async close(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Param('slotId') slot: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.closeSlot(r.headers.cookie, id, slot, raw));
  }
}
@Controller('v1/local-bookings')
export class LocalBookingsController {
  constructor(@Inject(SCB_LOCAL_SERVICES_SERVICE) private readonly service: LocalServicesService) {}
  @Get() async list(@Req() r: ApiRequest) {
    return envelope(r, await this.service.bookings(r.headers.cookie));
  }
  @Post() @HttpCode(200) async create(@Req() r: ApiRequest, @Body() raw: unknown) {
    return envelope(r, await this.service.book(r.headers.cookie, raw));
  }
  @Get(':id') async detail(@Req() r: ApiRequest, @Param('id') id: string) {
    return envelope(r, await this.service.bookingDetail(r.headers.cookie, id));
  }
  @Post(':id/checkin') @HttpCode(200) async checkin(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.issueCheckin(r.headers.cookie, id, raw));
  }
  @Post(':id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.bookingCommand(r.headers.cookie, id, raw));
  }
}
@Controller('v1/local-matchups')
export class LocalMatchupsController {
  constructor(@Inject(SCB_LOCAL_SERVICES_SERVICE) private readonly service: LocalServicesService) {}
  @Get() async list(@Req() r: ApiRequest) {
    return envelope(r, await this.service.matchups(r.headers.cookie));
  }
  @Post() @HttpCode(200) async create(@Req() r: ApiRequest, @Body() raw: unknown) {
    return envelope(r, await this.service.createMatchup(r.headers.cookie, raw));
  }
  @Post(':id/commands') @HttpCode(200) async command(
    @Req() r: ApiRequest,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return envelope(r, await this.service.matchupCommand(r.headers.cookie, id, raw));
  }
}
