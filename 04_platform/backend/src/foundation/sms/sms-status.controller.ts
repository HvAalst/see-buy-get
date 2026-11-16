import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../http/rate-limit.guard';
import { readAtReport } from './africastalking';
import { CodeRouteService } from './code-route.service';
import { readTwilioReport } from './twilio';

/**
 * 2026-11-16 — WHERE A ROUTE TELLS US WHAT BECAME OF A TEXT (the plan "Sign-in codes beyond Twilio SMS", D4): delivered,
 * or not — and not delivered, the code goes the next way. Public: the provider holds no sign-in of ours. A report counts
 * only for a text this server handed that route, named by the provider's own id for it, which nobody else holds; anything
 * else is answered the same and changes nothing.
 *
 * Twilio is told this address with each text (its `StatusCallback`). Africa's Talking is told it once, in its dashboard,
 * and AT_DELIVERY_REPORTS=on says so to this server.
 */
@Controller('sms/status')
export class SmsStatusController {
  constructor(private readonly routes: CodeRouteService) {}

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
}
