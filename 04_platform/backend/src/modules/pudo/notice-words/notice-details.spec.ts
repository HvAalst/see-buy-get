import { NOTICE_EN, NOTICE_TRANSLATIONS } from './catalog';
import { at, countryName, number, said, sayEnglish, sayIn } from './say';
import { carrierSaid, classSaid, paperDayShown, windowSaid } from '../notification-dispatcher.service';
import { serviceLineSaid } from '../vehicle-care.service';
import { ruleSummary } from '../api-version-notice.service';
import { airArrivalSaid, airArrivalWarning, airReleaseGaps, airReleaseGapsSaid } from '../air-release.types';
import { VEHICLE_CLASSES } from '../fleet.config';
import { API_RULE_CHANGES } from '../../../foundation/http/api-rules';
import { THE_COURIER } from './system-words';
import { utcShown } from '../export.service';
import { coldClash, coldClashSaid } from '../heavy-cargo';
import { declarationRefusalSaid } from '../security-declaration.service';
import { GlosError } from '../../../foundation/http/glos-error';

/*
 * 2026-11-27 — THE PIECES INSIDE NOTICES OUR OWN CODE WROTE IN ENGLISH (the owner: "fix as recommended"): a delivery window's
 * words, a vehicle's class, a service's due line, an unnamed courier, what keeps air cargo in the shed, a rule of the API, a
 * country's name, a number, a paper's day given as a moment. Each is said in the reader's language now — and its English is
 * word for word what the notice said before.
 */
const en = (v: ReturnType<typeof windowSaid>) => (typeof v === 'object' && v && 'key' in v ? sayEnglish(v) : String(v));
const inLang = (lang: 'nl' | 'bg' | 'sw' | 'am', v: ReturnType<typeof windowSaid>) => (typeof v === 'object' && v && 'key' in v ? sayIn(lang, v) : String(v));

describe('why a bag could not be given to a driver, said as phrases', () => {
  it('two cold loads: the same English as the refusal everywhere else, said in the driver’s language', () => {
    const aboard = [{ minC: -20, maxC: -18 }];
    const band = { minC: 2, maxC: 8 };
    expect(sayEnglish(coldClashSaid(aboard, band)!)).toBe(coldClash(aboard, band));
    expect(coldClash(aboard, band)).toBe('This truck already carries a load kept at -20 to -18 °C; this one must be kept at 2 to 8 °C. One body keeps one temperature: deliver that load first, or this one goes on another truck.');
    expect(sayIn('nl', coldClashSaid(aboard, band)!)).toContain('-18');
    expect(coldClashSaid([{ minC: 2, maxC: 8 }], band)).toBeUndefined();
  });

  it('an unsigned security declaration: to the driver, or of their fleet, by its state — anything else in its own words', () => {
    const refused = (kind: string, state: string) => declarationRefusalSaid(new GlosError('DECLARATION_REQUIRED', 'x', { kind, state, version: 2 }));
    expect(sayEnglish(refused('driver', 'missing')!)).toBe('You have not signed your security declaration: nothing new is taken on until you have. It is signed in the Driver app, on the home screen');
    expect(sayEnglish(refused('fleet', 'lapsed')!)).toBe('Your fleet has not signed its security declaration again this year: nothing new is taken on until it has. It is signed in the Fleet app, on the home screen');
    expect(sayEnglish(refused('fleet', 'outdated')!)).toContain('the new wording of its security declaration');
    expect(sayIn('bg', refused('driver', 'lapsed')!)).toBeDefined();
    expect(refused('shop', 'missing')).toBeUndefined();
    expect(declarationRefusalSaid(new GlosError('FORBIDDEN', 'x'))).toBeUndefined();
  });

  it('a sum with no currency keeps its two decimals in every language', () => {
    expect(sayIn('nl', said('dispatch2.serviceDue.atKm', { km: number('12.50', 12.5, 2) }))).toContain(new Intl.NumberFormat('nl', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(12.5));
    expect(sayEnglish(said('dispatch2.serviceDue.atKm', { km: number('12.50', 12.5, 2) }))).toBe('at 12.50 km');
  });
});

describe('the pieces a notice says', () => {
  it('a delivery window: the English as the plan says it, the words around the times in the reader’s language', () => {
    expect(en(windowSaid('08:00–12:00'))).toBe('08:00–12:00');
    expect(en(windowSaid('before 14:00'))).toBe('before 14:00');
    expect(en(windowSaid('from 09:30'))).toBe('from 09:30');
    expect(inLang('nl', windowSaid('before 14:00'))).toBe(NOTICE_TRANSLATIONS.nl['dispatch.window.before']!.replace('{to}', '14:00'));
    expect(inLang('bg', windowSaid('from 09:30'))).toContain('09:30');
    expect(inLang('bg', windowSaid('from 09:30'))).not.toContain('from');
  });

  it('every vehicle class has its phrase, whose English is the class itself; an unknown one is said as it is', () => {
    for (const c of VEHICLE_CLASSES) expect(en(classSaid(c))).toBe(c);
    expect(inLang('nl', classSaid('truck'))).toBe(NOTICE_TRANSLATIONS.nl['vehicle.class.truck']);
    expect(classSaid('hovercraft')).toBe('hovercraft');
  });

  it('a courier with no name is "The courier" in English and said in the language; a name is never translated', () => {
    expect(en(carrierSaid(THE_COURIER))).toBe('The courier');
    expect(inLang('sw', carrierSaid(THE_COURIER))).toBe(NOTICE_TRANSLATIONS.sw['dispatch2.breakdown.theCourier']);
    expect(carrierSaid('Pwani Hauliers')).toBe('Pwani Hauliers');
  });

  it('a service’s due line: the same English as the line on the screen, the day and the kilometres each language’s way', () => {
    const today = '2026-11-27';
    const line = (due: Parameters<typeof serviceLineSaid>[0]) => sayEnglish(serviceLineSaid(due, today)!);
    expect(line({ state: 'overdue', dueDay: '2026-11-20' })).toBe('Service overdue: it was due by 20 Nov 2026');
    expect(line({ state: 'overdue', dueDay: '2026-12-20', dueKm: 135000, currentKm: 136200 })).toBe('Service overdue: it was due at 135,000 km, and reads 136,200 km');
    expect(line({ state: 'soon', dueDay: '2026-12-03' })).toBe('Service due soon: by 3 Dec 2026');
    expect(line({ state: 'soon', dueKm: 135000, currentKm: 134100 })).toBe('Service due soon: at 135,000 km (it reads 134,100 km)');
    expect(line({ state: 'soon', dueDay: '2026-12-03', dueKm: 135000, currentKm: 134100 })).toBe('Service due soon: by 3 Dec 2026 or at 135,000 km, whichever comes first (it reads 134,100 km)');
    expect(serviceLineSaid({ state: 'ok', dueDay: '2027-03-01' }, today)).toBeUndefined();
    const nl = sayIn('nl', serviceLineSaid({ state: 'soon', dueKm: 135000, currentKm: 134100 }, today)!)!;
    expect(nl).toContain(new Intl.NumberFormat('nl').format(135000));
    expect(nl).not.toContain('135,000');
  });

  it('what keeps air cargo in the shed: the English list as before, a country by its own name in the language', () => {
    const step = { at: '2026-11-27T08:00:00Z', by: 'Clerk', recordedAt: '2026-11-27T08:00:00Z' };
    const cases = [
      { agencies: [{ key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)' }] },
      { customs: step, agencies: [], deliveryOrder: step },
      { agencies: [], landedIn: 'NL' },
      { customs: step, agencies: [], deliveryOrder: step, handlerCharges: step },
    ];
    for (const r of cases) {
      const said = airReleaseGapsSaid(r);
      expect(typeof said === 'object' && said && 'key' in said ? sayEnglish(said) : said).toBe(airReleaseGaps(r).join(', '));
    }
    const bg = airReleaseGapsSaid({ agencies: [], landedIn: 'NL' });
    expect(typeof bg === 'object' && bg && 'key' in bg ? sayIn('bg', bg) : '').toContain(new Intl.DisplayNames(['bg'], { type: 'region' }).of('NL')!);
  });

  it('Kenya’s customs office first in an arrival warning: the English as before, said in the language', () => {
    const input = { country: 'KE', landsOn: '2026-11-28', agencies: [{ key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)' }] };
    const warning = airArrivalWarning(input);
    const said = airArrivalSaid(input)!;
    expect(sayEnglish(said)).toBe(warning?.text);
    expect(warning?.text).toContain('Customs verification (KRA)');
    expect(sayIn('nl', said)).toContain(NOTICE_TRANSLATIONS.nl['importer.airArrival.office.customsKE']);
  });

  it('a rule of the API: every rule has its summary as a phrase, word for word — and a summary changed without it is said as written', () => {
    for (const r of API_RULE_CHANGES) {
      const s = ruleSummary(r);
      expect(en(s)).toBe(r.summary);
      expect(typeof s).toBe('object');
    }
    expect(ruleSummary({ id: 'vehicle-energy', summary: 'Something else now.' })).toBe('Something else now.');
    expect(ruleSummary({ id: 'no-such-rule', summary: 'New rule.' })).toBe('New rule.');
  });

  it('a country, a number and a paper’s day each the language’s way; the English as the sender wrote it', () => {
    expect(sayEnglish(said('countryNotice.opened.title', { country: countryName('Netherlands', 'NL') }))).toBe(NOTICE_EN['countryNotice.opened.title'].replace('{country}', 'Netherlands'));
    expect(sayIn('bg', said('countryNotice.opened.title', { country: countryName('Netherlands', 'NL') }))).toContain(new Intl.DisplayNames(['bg'], { type: 'region' }).of('NL')!);
    expect(sayIn('nl', said('countryNotice.opened.title', { country: countryName('Somewhere', 'not-a-code') }))).toContain('Somewhere');
    expect(sayIn('nl', said('dispatch2.serviceDue.atKm', { km: number('135,000', 135000) }))).toContain(new Intl.NumberFormat('nl').format(135000));
    // A paper's day given as a moment: the day before it lapses, written as a day in every language — not English.
    const shown = paperDayShown('2027-03-01T00:00:00.000Z');
    expect(typeof shown === 'object' && shown && 'day' in shown ? shown.day : undefined).toBe('2027-02-28');
    expect(paperDayShown('not a date')).toBe('not a date');
    // A cut-off said in UTC says it is UTC in every language.
    expect(sayEnglish(said('dispatch2.serviceDue.byDay', { day: utcShown('2026-10-28T18:00:00.000Z') }))).toBe('by 28 Oct 2026 18:00 UTC');
    expect(sayIn('bg', said('dispatch2.serviceDue.byDay', { day: utcShown('2026-10-28T18:00:00.000Z') }))).toContain('UTC');
    expect(sayIn('nl', said('dispatch2.serviceDue.byDay', { day: at('28 Oct 2026 18:00 UTC', '2026-10-28T18:00:00.000Z') }))).toContain('UTC');
  });
});
