import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * 2026-11-27 — THE REFUSALS PEOPLE MEET MOST ARE PHRASES (the owner: "continue the weak spots"). Signing in, a PIN, a password, a
 * code, a payout and a payment: every refusal these files make is `refused(code, said(…))`, so the app says it in its language.
 * A refusal written as English text here fails this — but for the few that carry a provider's own words (said as they are).
 */
const SRC = join(__dirname, '..', '..', '..');
const FILES = [
  'modules/pudo/account.service.ts',
  'modules/pudo/person.service.ts',
  'modules/pudo/otp.service.ts',
  'modules/pudo/email-code.service.ts',
  'modules/pudo/truecaller.service.ts',
  'modules/pudo/account-recovery.service.ts',
  'modules/pudo/identity.controller.ts',
  'modules/pudo/passkey.service.ts',
  'modules/pudo/account-move.service.ts',
  'modules/pudo/payout-number.service.ts',
  'foundation/payouts/payout.service.ts',
  'foundation/funding/funding.service.ts',
  'modules/pudo/funding-payers.ts',
  'modules/pudo/wallet-gate.service.ts',
  'foundation/payment-hub/payment-hub.service.ts',
  'foundation/mollie/mollie-connect.service.ts',
  'modules/pudo/person-load-pay.service.ts',
  'modules/pudo/direct-pay.service.ts',
  'modules/pudo/booking-pay.service.ts',
];
/** Words that are not ours to translate: what the text provider said, or a payee's standing written elsewhere. */
const PROVIDERS_WORDS = /notSentWords\(|payee\.notPayee/;

describe('the refusals people meet most', () => {
  it.each(FILES)('%s makes every refusal as a phrase', (file) => {
    const lines = readFileSync(join(SRC, file), 'utf8').split(/\r?\n/);
    const plain = lines
      .map((line, i) => ({ line, at: i + 1 }))
      .filter(({ line }) => /new GlosError\(/.test(line) && !PROVIDERS_WORDS.test(line))
      .map(({ line, at }) => `${file}:${at} ${line.trim().slice(0, 120)}`);
    expect(plain).toEqual([]);
  });
});
