import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../http/rate-limit.guard';
import { readAtReport } from './africastalking';
import { TelegramSender, WhatsAppSender } from './app-route.senders';
import { CodeRouteService } from './code-route.service';
import { readTelegramReport, telegramSigned } from './telegram';
import { readTwilioReport } from './twilio';
import { readWhatsAppReports, whatsAppSigned } from './whatsapp';

/**
 * 2026-11-16 — WHERE A ROUTE TELLS US WHAT BECAME OF A TEXT (the plan "Sign-in codes beyond Twilio SMS", D4): delivered,
 * or not — and not delivered, the code goes the next way. Public: the provider holds no sign-in of ours.
 *
 * - Twilio and Africa's Talking: a report counts only for a text this server handed that route, named by the provider's own
 *   id for it, which nobody else holds; anything else is answered the same and changes nothing.
 * - WhatsApp and Telegram: believed only with their signature over the bytes as they came (read raw, `sms-reports.raw.ts`);
 *   an unsigned or wrongly signed one is refused and changes nothing.
 *
 * Twilio and Telegram are told this address with each message. Africa's Talking and WhatsApp are told it once, in their
 * dashboards — the console's Sign-in codes screen shows the address.
 */
@Controller('sms/status')
export class SmsStatusController {
  constructor(
    private readonly routes: CodeRouteService,
    private readonly whatsApp: WhatsAppSender,
    private readonly telegram: TelegramSender,
  ) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(1200, 15 * 60)
  @Post('twilio')
  @HttpCode(204)
  async twilio(@Body() body: Record<string, unknown>): Promise<void> {
    const report = readTwilioReport(body);
    if (report) await this.routes.report('twilio', report.ref, report.outcome);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(1200, 15 * 60)
  @Post('africastalking')
  @HttpCode(204)
  async africastalking(@Body() body: Record<string, unknown>): Promise<void> {
    const report = readAtReport(body);
    if (report) await this.routes.report('africastalking', report.ref, report.outcome);
  }

  /** Meta's check that the address is ours: the verify token we set there, answered with its challenge. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Get('whatsapp')
  whatsAppVerify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string): string {
    const want = this.whatsApp.config.verifyToken;
    if (mode !== 'subscribe' || !want || token !== want || !challenge || !/^[\w-]{1,128}$/.test(challenge)) throw new ForbiddenException();
    return challenge;
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(1200, 15 * 60)
  @Post('whatsapp')
  @HttpCode(200)
  async whatsAppReport(@Req() req: Request, @Headers('x-hub-signature-256') signature?: string): Promise<{ ok: true }> {
    const raw = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!raw || !whatsAppSigned(raw, signature, this.whatsApp.config.appSecret)) throw new ForbiddenException();
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return { ok: true };
    }
    for (const r of readWhatsAppReports(body)) await this.routes.report('whatsapp', r.ref, r.outcome);
    return { ok: true };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(1200, 15 * 60)
  @Post('telegram')
  @HttpCode(200)
  async telegramReport(@Req() req: Request, @Headers('x-request-timestamp') timestamp?: string, @Headers('x-request-signature') signature?: string): Promise<{ ok: true }> {
    const raw = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!raw || !telegramSigned(raw, timestamp, signature, this.telegram.config.token)) throw new ForbiddenException();
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return { ok: true };
    }
    const r = readTelegramReport(body);
    if (r) await this.routes.report('telegram', r.ref, r.outcome);
    return { ok: true };
  }
}
