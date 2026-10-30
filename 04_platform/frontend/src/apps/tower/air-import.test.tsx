import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ImportByAir, type ImportAirView } from './screens/ImportByAir';

/** The page's words, its markup taken out: a sentence with a term of the trade in it is drawn in pieces (shared/ui/Abbr.tsx). */
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/*
 * AN IMPORT BY AIR, ON THE SCREEN (2026-10-29). Each release step for whoever may record it, the gate in the board's own
 * words, the handler's free hours counted, the importer alone sending the truck anyway — and staff only reading.
 */
const calls = { agencies: async () => ({ data: { items: [], source: '' } }), set: async () => ({}), step: async () => ({}), anyway: async () => ({}) };
const air = (over: Partial<ImportAirView> = {}): ImportAirView =>
  ({
    awb: '074-12345675',
    waybillKind: 'master',
    airline: 'KLM / Martinair',
    flights: [{ flight: 'KL 565', date: '2026-10-29', from: 'AMS', to: 'NBO' }],
    arrivalAirport: 'NBO',
    handler: 'Swissport cargo shed, JKIA',
    pieces: 12,
    weightKg: 240,
    agencies: [{ key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)' }],
    freeHours: 48,
    freeHoursSource: 'Swissport’s notice of arrival',
    recordedAt: '2026-10-29T06:00:00Z',
    recordedBy: 'Juma',
    gaps: ['the customs release', 'the release by Kenya Bureau of Standards (KEBS)', 'the handler’s delivery order'],
    clock: { state: 'not_started', freeHours: 48 },
    roadWaits: 'Not released yet at Swissport cargo shed, JKIA: still waiting for the customs release.',
    check: { number: '074-12345675', regime: 'mc99', rules: 'The Montreal Convention 1999', limits: ['At most 26 SDR a kilogram.'], claims: [], caveats: [], mismatches: [] },
    ...over,
  }) as ImportAirView;
const render = (a: ImportAirView | undefined, youAre: string) => renderToString(<ImportByAir code="IMP-009" {...(a ? { air: a } : {})} youAre={youAre} destCountry="KE" calls={calls} onChanged={() => undefined} />);

describe('an import by air', () => {
  it('while it is in the shed: every step for its importer, the gate in the board’s words, and the word to go anyway', () => {
    const html = render(air(), 'importer');
    for (const shown of [t('tower.byAir.step.notified'), t('tower.byAir.step.customs'), 'Kenya Bureau of Standards', t('tower.byAir.step.deliveryOrder'), 'Not released yet at Swissport cargo shed, JKIA', t('tower.byAir.sendAnyway'), t('tower.byAir.clock.notStarted'), 'The Montreal Convention 1999']) expect(textOf(html)).toContain(shown);
  });

  it('its agent records the steps, but only the importer sends the truck anyway; staff only read', () => {
    const agent = render(air(), 'agent');
    expect(agent).toContain(t('tower.byAir.record'));
    expect(agent).not.toContain(t('tower.byAir.sendAnyway'));
    const staff = render(air(), 'onlooker');
    expect(staff).not.toContain(t('tower.byAir.record'));
    expect(staff).not.toContain(t('tower.byAir.change'));
    expect(render(undefined, 'onlooker')).toContain(t('tower.byAir.noneYet'));
  });

  it('counts the free hours from the notice, and says a release once recorded — never a price', () => {
    const running = render(air({ notified: { at: '2026-10-29T04:00:00Z', by: 'Juma', recordedAt: '2026-10-29T04:05:00Z', reference: 'NFD-88120' }, clock: { state: 'due_soon', freeHours: 48, freeUntil: '2026-10-31T04:00:00Z', hoursLeft: 4 } }), 'importer');
    expect(running).toContain(t('tower.byAir.clock.dueSoon', { handler: 'Swissport cargo shed, JKIA', until: '2026-10-31 04:00 UTC', left: 4 }));
    expect(running).toContain('NFD-88120');
    expect(running).not.toMatch(/KES|USD|\$/);
    const released = render(air({ gaps: [], roadWaits: undefined, customs: { reference: '2026NBOIM448120', at: '2026-10-29T08:00:00Z', by: 'Juma', recordedAt: '2026-10-29T08:00:00Z' } }), 'importer');
    expect(released).toContain(t('tower.byAir.releasedTag'));
    expect(released).not.toContain(t('tower.byAir.sendAnyway'));
    expect(render(air({ collectAnyway: { by: 'Wanjiku', at: '2026-10-29T09:00:00Z', reason: 'The agent says it is out within the hour' } }), 'importer')).toContain('The agent says it is out within the hour');
  });

  it('with nothing recorded yet, asks its importer or agent for the waybill — the digit checked as it is typed', () => {
    const html = render(undefined, 'agent');
    expect(html).toContain(t('tower.byAir.f.awb'));
    expect(html).toContain(t('tower.byAir.f.handler'));
    expect(html).toContain(t('tower.byAir.freeHint.KE'));
  });
});

describe('live animals and a landing that may wait, on the import', () => {
  it('says the animals, the vet-named place and the keeper’s word — and a weekend landing, as a warning', () => {
    const html = render(
      air({
        animals: { kind: 'livestock', species: 'Dairy heifers', count: 20, permit: 'VS03-2026-118', healthCertificate: 'NL-VC-55120', fitToTravel: { by: 'Wanjiku', at: '2026-10-30T08:00:00Z' }, destination: { label: 'Kabete quarantine station', location: { lat: -1.25, lng: 36.73 }, namedOn: 'Permit VS03-2026-118' } },
        warnings: ['It lands on Saturday 31 October. Customs verification (KRA) works Monday to Friday at the airport, so the release may wait for the next working day. Your agent may ask for officers to attend out of hours on Form C.1.'],
      } as never),
      'importer',
    );
    expect(html).toContain(t('tower.animals.held', { count: 20, species: 'Dairy heifers', place: 'Kabete quarantine station', namedOn: 'Permit VS03-2026-118', by: 'Wanjiku' }));
    expect(html).toContain('It lands on Saturday 31 October');
    expect(html).toContain('Form C.1');
    // Without the place yet: said that no truck is posted until the importer names it.
    expect(render(air({ animals: { kind: 'crated', species: 'Day-old chicks', count: 4000, permit: 'P', healthCertificate: 'H', fitToTravel: { by: 'Juma', at: '2026-10-30T08:00:00Z' } }, warnings: [] } as never), 'agent')).toContain(t('tower.animals.heldNoPlace', { count: 4000, species: 'Day-old chicks', by: 'Juma', place: '', namedOn: '' }));
  });

  it('the road leg asks no destination where the veterinary officer named the place', async () => {
    const { roadBlocker, EMPTY_ROAD_FORM } = await import('./imports');
    const form = { ...EMPTY_ROAD_FORM, pickupSiteId: 'site_shed', weightKg: '9000' };
    expect(roadBlocker(form)).toBe('tower.imports.needDest');
    expect(roadBlocker(form, false, true)).toBeNull();
  });
});
