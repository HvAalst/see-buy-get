import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PayoutInstruction, PayoutRail } from './payout.types';

/**
 * The sandbox rail — it hands back a reference and nothing else.
 *
 * Deliberately incapable of settling anything. It would be one line to have it return "settled" and it
 * would teach every screen and every test above it that a payout completes the instant you ask, which is
 * the single most misleading thing a stub can do: the real rail is a mobile-money B2C call whose answer
 * arrives minutes later on a callback, and sometimes does not arrive at all.
 *
 * So a sandbox payment sits in `submitted` until somebody confirms it, exactly as a real one does. The
 * operator page has the button; a live deployment has a webhook. Both go through the same door.
 */
@Injectable()
export class SandboxPayoutRail implements PayoutRail {
  submit(instruction: PayoutInstruction): { providerRef: string } {
    // Shaped like the references these rails actually issue, so a screen that displays one is laid out for
    // the real thing rather than for a number that will change length on cutover.
    return { providerRef: `SBX${randomBytes(6).toString('hex').toUpperCase()}` };
  }
}
