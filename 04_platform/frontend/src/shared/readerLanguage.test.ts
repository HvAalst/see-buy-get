import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setLocale } from './i18n';
import { defaultReaderLanguage, readerLanguages } from './readerLanguage';
import { personLoadBody, EMPTY_PERSON_LOAD } from '../apps/genesis/personLoads';

/*
 * 2026-11-27 — THE LANGUAGE A RECEIVER READS (the owner: "continue the weak spots"). A receiver named by email is written to in
 * the language the sender chose for them — the sender's own unless they chose another — and only where they are named by email.
 * Every form that names a receiver by email asks it.
 */
describe('the language a receiver reads', () => {
  afterEach(() => setLocale('en'));

  it('is one the server writes emails in, the sender’s own by default — English where theirs is none of them', () => {
    expect(readerLanguages()).toContain('en');
    for (const l of readerLanguages()) expect(['en', 'sw', 'nl', 'am', 'bg']).toContain(l);
    expect(defaultReaderLanguage()).toBe('en');
    setLocale('sw');
    expect(defaultReaderLanguage()).toBe('sw');
  });

  it('goes with the receiver’s email, and only with it: the sender’s own, or the one they chose', () => {
    const filled = (over: Partial<ReturnType<typeof EMPTY_PERSON_LOAD>>) => ({ ...EMPTY_PERSON_LOAD('+256700123456', '60'), description: 'A fridge', from: { label: 'Ntinda', pin: { lat: 0.35, lng: 32.6 } }, to: { label: 'Entebbe', pin: { lat: 0.05, lng: 32.46 } }, ...over });
    expect(personLoadBody(filled({}))).not.toHaveProperty('receiverLanguage');
    setLocale('nl');
    expect(personLoadBody(filled({ receiverEmail: 'achieng@example.com' }))).toMatchObject({ receiverEmail: 'achieng@example.com', receiverLanguage: 'nl' });
    expect(personLoadBody(filled({ receiverEmail: 'achieng@example.com', receiverLanguage: 'sw' }))).toMatchObject({ receiverLanguage: 'sw' });
  });

  it('is asked wherever a receiver is named by email, beside that email', () => {
    for (const [screen, body] of [
      ['apps/genesis/screens/PersonLoad.tsx', 'apps/genesis/personLoads.ts'],
      ['apps/agent/screens/FreightBooking.tsx', 'apps/agent/useAgentApp.ts'],
      ['apps/business/screens/PostLoad.tsx', 'apps/business/postLoad.ts'],
      ['apps/business/screens/ParcelsScreen.tsx', 'apps/business/parcels.ts'],
    ]) {
      const src = readFileSync(`src/${screen}`, 'utf8');
      expect(`${screen}: ${src.includes('<ReaderLanguageOptions />') || src.includes('options={readerLanguageChoices()}')}`).toBe(`${screen}: true`);
      expect(`${body}: ${/receiverLanguage: (f|form)\.receiverLanguage \|\| defaultReaderLanguage\(\)/.test(readFileSync(`src/${body}`, 'utf8'))}`).toBe(`${body}: true`);
    }
  });
});
