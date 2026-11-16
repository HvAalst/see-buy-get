import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasskeyOffer, offerPasskeyAfterCode, offerable, takeOfferPin } from './PasskeyOffer';
import type { PasskeyApi } from './passkey';

/*
 * 2026-11-16 — THE FINGERPRINT, OFFERED RIGHT AFTER A CODE SIGN-IN (the plan "Sign-in codes beyond Twilio SMS", D5). The PIN
 * just chosen is held in memory for the one tap, a few minutes at most, and given once; with none held, nothing shows. Each
 * app that signs in by code and a PIN offers it: the Send, Driver and Business apps.
 */
describe('the passkey offer after a code sign-in', () => {
  it('holds the PIN just chosen for three minutes, and gives it once', () => {
    const t0 = Date.parse('2026-11-16T10:00:00Z');
    offerPasskeyAfterCode('4826', t0);
    expect(takeOfferPin(t0 + 60_000)).toBe('4826');
    expect(takeOfferPin(t0 + 61_000)).toBeNull();
    offerPasskeyAfterCode('4826', t0);
    expect(takeOfferPin(t0 + 3 * 60_000 + 1)).toBeNull();
  });

  it('is offered only where this phone holds the person’s key, nothing is on yet, and colleagues do not share it', () => {
    expect(offerable({ which: 0, on: false } as never)).toBe(true);
    expect(offerable({ which: -1, on: false } as never)).toBe(false);
    expect(offerable({ which: 0, on: true } as never)).toBe(false);
    expect(offerable({ which: 0, on: false, counter: '2026-11-01T00:00:00Z' } as never)).toBe(false);
    expect(offerable(null)).toBe(false);
  });

  it('shows nothing without a sign-in by code just now', () => {
    const api = { read: async () => ({ data: null, error: null }) } as unknown as PasskeyApi;
    expect(renderToString(<PasskeyOffer api={api} />)).toBe('');
  });

  it('is offered by every app that signs in by a code and a PIN, right after it', () => {
    const read = (p: string) => readFileSync(join('src', p), 'utf8');
    for (const [hook, shell] of [
      ['apps/genesis/useSendApp.ts', 'apps/genesis/app.tsx'],
      ['apps/driver/useDriverApp.ts', 'apps/driver/app.tsx'],
      ['apps/business/useBusinessApp.ts', 'apps/business/app.tsx'],
    ]) {
      expect({ hook, offers: read(hook).includes('offerPasskeyAfterCode(') }).toEqual({ hook, offers: true });
      expect({ shell, shows: read(shell).includes('<PasskeyOffer api={account.passkey}') }).toEqual({ shell, shows: true });
    }
  });
});
