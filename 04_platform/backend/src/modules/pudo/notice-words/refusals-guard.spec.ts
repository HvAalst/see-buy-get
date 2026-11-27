import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * 2026-11-27 — THE REFUSALS PEOPLE MEET MOST ARE PHRASES (the owner: "continue the weak spots", then "continue"). Signing in, a
 * PIN, a password, a code, a payout, a payment; the driver's board and loads; parcels at the counter; shops, drivers and their
 * shifts; hubs; and the doors of the main controller: every refusal these files write is `refused(code, said(…))`, so the app
 * says it in its language. A refusal written here as English text — a quoted sentence or a template — fails this. One that
 * passes on words made elsewhere (another service's refusal, a provider's own words) is not written here, and is not judged.
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
  // 2026-11-27 — the next areas people meet most.
  'modules/pudo/dispatch.service.ts',
  'modules/pudo/parcel.service.ts',
  'modules/pudo/pudo.controller.ts',
  'modules/pudo/agent.service.ts',
  'modules/pudo/driver.service.ts',
  'modules/pudo/fleet.service.ts',
  'modules/pudo/mdp.service.ts',
  'modules/pudo/hub-arrival.service.ts',
];

describe('the refusals people meet most', () => {
  it.each(FILES)('%s writes every refusal as a phrase', (file) => {
    const src = readFileSync(join(SRC, file), 'utf8');
    const plain = [...src.matchAll(/new GlosError\(\s*'[A-Z_]+'\s*,\s*(['"`])/g)].map((m) => {
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      return `${file}:${line} ${src.slice(m.index, m.index + 110).replace(/\s+/g, ' ')}`;
    });
    expect(plain).toEqual([]);
  });
});
