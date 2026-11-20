import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { actingTenant } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { MollieConnectionView, MollieConnectStarted, type MolliePayee } from '../../foundation/mollie/mollie.types';
import { DirectPayService } from './direct-pay.service';
import { FeeInvoiceList, FeeInvoiceService } from './fee-invoice.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { NETWORK_JURISDICTION } from './pudo.config';

/** Mollie's notice: a payment's id, form-encoded, and nothing else. */
export class MollieWebhookDto {
  @ApiPropertyOptional({ description: 'Mollie’s own id for the payment (tr_…): the only thing its notice carries.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;
}

/**
 * 2026-11-19 — A CARRIER CONNECTS ITS OWN MOLLIE ACCOUNT, from its own Settings (the payments plan, part 2). Whose account it
 * is follows who is paid for a load the shipper pays directly: a courier is paid itself; a fleet driver is not — its fleet is,
 * and the fleet's office connects it. Staff connect nobody's account. Mollie's sign-in comes back to the callback below,
 * which sends the carrier on to its own app with how it ended.
 */
@Controller('sbg/mollie')
export class MollieController {
  constructor(
    private readonly mollie: MollieConnectService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly direct: DirectPayService,
    private readonly feeInvoices: FeeInvoiceService,
  ) {}

  /** 2026-11-20 — the invoices for our fee on this carrier's payments by Mollie, one a month (part 2c): newest first. */
  @Roles('driver', 'fleet_manager')
  @Get('invoices')
  invoices(@Actor() actor: IntrospectionResult): FeeInvoiceList {
    return this.feeInvoices.listFor(this.paidAs(actor));
  }

  /** One of them, as its printable page — only to the carrier it is made out to. */
  @Roles('driver', 'fleet_manager')
  @Get('invoices/:id/invoice.html')
  @Header('content-type', 'text/html; charset=utf-8')
  invoiceHtml(@Param('id') id: string, @Actor() actor: IntrospectionResult): string {
    return this.feeInvoices.html(id, this.paidAs(actor));
  }

  private paidAs(actor: IntrospectionResult | undefined): string {
    const payee = this.payeeOf(actor);
    if ('notPayee' in payee) throw new GlosError('FORBIDDEN', payee.notPayee);
    return payee.payeeId;
  }

  /**
   * 2026-11-19 — MOLLIE'S NOTICE OF A PAYMENT (part 2b): only its id, unsigned — so the payment is asked for from Mollie and
   * that answer counts. An id not ours is answered 200 and ignored; a Mollie that does not answer our question is answered
   * 503, so Mollie tries again (ten times over a day).
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(600, 15 * 60)
  @HttpCode(200)
  @Post('webhook')
  async webhook(@Body() dto: MollieWebhookDto): Promise<{ ok: true }> {
    if (dto?.id) await this.direct.onWebhook(dto.id);
    return { ok: true };
  }

  /** Where the payer comes back to after Mollie's checkout: how it went, by our own random reference. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Get('paid/:ref')
  paid(@Param('ref') ref: string, @Res() res: Response): void {
    res.status(200).type('html').send(this.direct.paidPage(ref));
  }

  @Roles('driver', 'fleet_manager')
  @Get()
  mine(@Actor() actor: IntrospectionResult): MollieConnectionView {
    return this.mollie.view(this.payeeOf(actor));
  }

  @Roles('driver', 'fleet_manager')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('connect')
  connect(@Actor() actor: IntrospectionResult): MollieConnectStarted {
    return this.mollie.connect(this.payeeOf(actor));
  }

  @Roles('driver', 'fleet_manager')
  @Delete()
  disconnect(@Actor() actor: IntrospectionResult): Promise<MollieConnectionView> {
    return this.mollie.disconnect(this.payeeOf(actor));
  }

  /** Mollie's sign-in sends the carrier back here: the code exchanged, then on to its own app with how it ended. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  @Get('oauth/callback')
  async callback(@Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response): Promise<void> {
    const back = await this.mollie.finish({ code, state, error });
    res.redirect(302, this.mollie.backTo(back));
  }

  /** Who this caller is paid as, for a load the shipper pays directly. */
  private payeeOf(actor: IntrospectionResult | undefined): MolliePayee {
    const role = actor?.role;
    if (role === 'operator') throw new GlosError('FORBIDDEN', 'Staff do not connect a carrier’s Mollie account: the carrier does, in its own Settings');
    if (role === 'driver' && actor?.did) {
      const driver = this.drivers.get(actor.did);
      const country = driver.jurisdiction ?? NETWORK_JURISDICTION;
      if (driver.managerDid) return { notPayee: 'Your fleet is paid for your work: its office connects Mollie', country };
      return { payeeId: driver.did, country, by: driver.did, back: 'driver' };
    }
    if (role === 'fleet_manager') {
      const fleetDid = actingTenant(actor);
      if (!fleetDid) throw new GlosError('FORBIDDEN', 'Sign in as the fleet’s office');
      const fleet = this.managers.get(fleetDid);
      return { payeeId: fleet.did, country: fleet.jurisdiction ?? NETWORK_JURISDICTION, by: actor?.did ?? fleet.did, back: 'fleet' };
    }
    throw new GlosError('FORBIDDEN', 'Only a carrier connects a Mollie account');
  }
}
