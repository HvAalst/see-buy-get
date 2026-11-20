import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';

/*
 * 2026-11-20 — A BOOKING GETS A CODE, THE LABEL COMES ONCE PAID (the payments plan, 4d; P4-e "as recommended"). Where no phone
 * payment runs yet, a Send-app booking is not labelled at home: the sender shows its code at the shop, pays there, and the shop
 * prints the label and sticks it on. Held to here: the Send app shows the code and says it is not a label, offers nothing to
 * print, and says so in every language; the Shop app prints the label of a paid booking from the take-in sheet.
 */
const read = (p: string) => readFileSync(join('src', p), 'utf8');

describe('a Send-app booking, at booking', () => {
  it('shows the code and says it is not a label — and offers nothing to print at home', () => {
    const screen = read('apps/genesis/screens/SendScreen.tsx');
    expect(screen).toContain('const svg = m.code?.svg ?? null;');
    expect(screen).toContain("t('send.done.codeHint')");
    expect(screen).not.toContain("t('send.done.openLabel')");
    expect(screen).not.toContain('m.label');
    expect(t('send.done.title' as never)).toBe('Your parcel is booked');
    expect(t('send.done.codeHint' as never)).toBe('This is not a label: there is nothing to print at home. The shop scans this code.');
    expect(read('apps/genesis/types.ts')).toMatch(/code: \{ parcelId: string; qrPayload: string; svg: string \};/);
    for (const locale of ['sw', 'nl', 'am']) {
      const words = read(`shared/i18n/words/${locale}/send.ts`);
      expect(words).toContain('"send.done.codeHint"');
      expect(words).not.toContain('"send.done.openLabel"');
    }
  });
});

describe('the same booking, at the counter', () => {
  it('paid: its label, made only now, printed from the take-in sheet — on screen or on the thermal printer', () => {
    const app = read('apps/agent/useAgentApp.ts');
    expect(app).toMatch(/pm\.kind === 'peer_send' && narrow<\{ label\?: \{ svg\?: string \} \}>\(r\.data\)\?\.label\?\.svg/);
    const screen = read('apps/agent/screens/AcceptScreen.tsx');
    expect(screen).toMatch(/\{state\.intakeDone\.label \? \(\s*<>\s*<p class="t-body">\{t\('agent\.accept\.donePrintLabel', \{ parcel: state\.intakeDone\.parcelId \}\)\}<\/p>\s*<TakenInLabel label=\{state\.intakeDone\.label\} onThermal=/);
    expect(t('agent.accept.donePrintLabel' as never, { parcel: 'PUD-1' } as never)).toBe('Paid: print the label of PUD-1 now and stick it on.');
  });
});
