import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { UserRole } from '@shorts/db';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billing: BillingService,
    private quota: QuotaService,
  ) {}

  // §8.2 /billing/checkout (OWNER)
  @Post('checkout')
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.OWNER) // §9.2: "Manage billing / plans" is Owner-only
  async checkout(@Body() dto: CreateCheckoutDto, @Req() req: AuthenticatedRequest) {
    const url = await this.billing.createCheckoutSession(req.organizationId, dto.plan, req.user.sub);
    return { url };
  }

  // §8.2 /billing/portal (OWNER)
  @Get('portal')
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.OWNER)
  async portal(@Req() req: AuthenticatedRequest) {
    const url = await this.billing.createPortalSession(req.organizationId);
    return { url };
  }

  // Powers the §11.6 /billing quota bar. Any authenticated role can view.
  @Get('usage')
  @UseInterceptors(TenantInterceptor)
  usage(@Req() req: AuthenticatedRequest) {
    return this.quota.usageThisMonth(req.organizationId);
  }

  // §8.2 /billing/webhook — Stripe webhook (Stripe-Signature validated).
  // Public to JwtAuthGuard: Stripe has no user JWT. Trust comes from the
  // signature check inside BillingService.handleWebhook(), not from a
  // shared secret header like our worker callbacks (§9.4) — this is a
  // different, Stripe-controlled trust boundary.
  //
  // Requires `rawBody: true` passed to NestFactory.create() in main.ts so
  // req.rawBody is the exact bytes Stripe signed — re-serialized JSON
  // would fail signature verification even with correct content.
  //
  // PR 9 (Security Hardening, §19.1): dedicated 'webhook' throttle bucket
  // (30/min, see app.module.ts) rather than the shared default/internal
  // buckets. Legitimate Stripe webhook volume is low and predictable; this
  // is defense in depth on top of signature verification, not the primary
  // control — a request that fails the throttle never even reaches
  // handleWebhook()'s constructEvent() check.
  @Throttle({ webhook: { limit: 30, ttl: 60_000 } })
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!signature) throw new BadRequestException('Missing Stripe-Signature header');
    if (!req.rawBody) throw new BadRequestException('Missing raw body — check main.ts rawBody config');
    await this.billing.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
